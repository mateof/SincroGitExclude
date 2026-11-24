import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { getDb } from '../database/connection'
import { execGit } from '../git/git-exec'
import { GitExcludeService } from '../git/git-exclude'
import type { RepoService } from '../services/repo-service'
import { readMcpConfig } from '../mcp/mcp-config'
import type { KbService } from './kb-service'
import { applyLink, originUrl, planLink, readPointer, removeLink, type LinkState, type LinkTarget } from './repo-link/pointer'
import { normalizeRemoteUrl, readRegistry, removeFromRegistry, upsertRegistry } from './repo-link/registry'
import { normalizeRel, resolveInSpace } from './paths'
import type {
  KbRepoContext,
  KbRepoIntegrations,
  KbRepoLink,
  KbRepoLinkInput,
  KbRepoLinkPlanItem,
  KbRepoSuggestion
} from '../../shared/kb/types'

interface LinkRow {
  repo_id: string
  space_id: string
  note_path: string
  integrations: string
  created_at: string
  path: string
}

interface StoredIntegrations extends KbRepoIntegrations {
  state?: LinkState
  remote?: { mcpUrl: string; spaceName: string } | null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function noteTemplate(name: string, remote: string | null, language: 'es' | 'en'): string {
  const repoLine = remote ? `repo: ${remote}\n` : ''
  if (language === 'en') {
    return `---\ntags: [project]\n${repoLine}status: active\ndate: ${today()}\n---\n\n# ${name}\n\n## Context\n\n## Decisions\n\n## Recent work\n\n## Open items\n`
  }
  return `---\ntags: [project]\n${repoLine}status: activo\ndate: ${today()}\n---\n\n# ${name}\n\n## Contexto\n\n## Decisiones\n\n## Trabajo reciente\n\n## Pendiente\n`
}

export function userLevelMcpConfigured(port: number, claudeJsonPath = join(homedir(), '.claude.json')): boolean {
  if (!existsSync(claudeJsonPath)) return false
  try {
    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf-8')) as { mcpServers?: Record<string, { url?: string }> }
    return Object.values(parsed.mcpServers ?? {}).some(
      (s) => typeof s?.url === 'string' && new RegExp(`:${port}/mcp/?$`).test(s.url)
    )
  } catch {
    return false
  }
}

async function repoTopLevel(path: string): Promise<string> {
  try {
    const out = await execGit(['rev-parse', '--show-toplevel'], { cwd: path })
    return out.stdout.toString('utf-8').trim()
  } catch {
    throw new Error(`Not inside a git repository: ${path}`)
  }
}

export class KbRepoService {
  constructor(
    private readonly kb: KbService,
    private readonly repos: RepoService
  ) {}

  private localMcpUrl(): string {
    return `http://127.0.0.1:${readMcpConfig().port}/mcp`
  }

  private async buildTarget(input: KbRepoLinkInput): Promise<LinkTarget> {
    const repoPath = resolve(input.repoPath)
    if (!new GitExcludeService().isGitRepo(repoPath)) throw new Error(`Not a git repository: ${repoPath}`)
    const notePath = normalizeRel(input.notePath.endsWith('.md') ? input.notePath : `${input.notePath}.md`)
    if (input.remote) {
      return {
        repoPath,
        spaceId: input.spaceId,
        spaceName: input.remote.spaceName,
        vaultPath: '',
        notePath,
        noteAbsolutePath: '',
        mcpUrl: input.remote.mcpUrl,
        localVault: false,
        userLevelMcp: false,
        integrations: input.integrations
      }
    }
    const space = this.kb.getSpace(input.spaceId)
    const root = this.kb.rootPathOf(space.id)
    return {
      repoPath,
      spaceId: space.id,
      spaceName: space.name,
      vaultPath: root,
      notePath,
      noteAbsolutePath: resolveInSpace(root, notePath),
      mcpUrl: this.localMcpUrl(),
      localVault: true,
      userLevelMcp: userLevelMcpConfigured(readMcpConfig().port),
      integrations: input.integrations
    }
  }

  async preview(input: KbRepoLinkInput): Promise<{ items: KbRepoLinkPlanItem[]; noteExists: boolean }> {
    const target = await this.buildTarget(input)
    const plan = await planLink(target)
    return { items: plan.items, noteExists: target.localVault ? existsSync(target.noteAbsolutePath) : true }
  }

  private rowFor(repoId: string): LinkRow | null {
    return (
      (getDb()
        .prepare('SELECT l.*, r.path FROM kb_repo_links l JOIN repos r ON r.id = l.repo_id WHERE l.repo_id = ?')
        .get(repoId) as LinkRow | undefined) ?? null
    )
  }

  private toLink(row: LinkRow): KbRepoLink {
    const stored = JSON.parse(row.integrations || '{}') as StoredIntegrations
    return {
      repoId: row.repo_id,
      repoPath: row.path,
      spaceId: row.space_id,
      notePath: row.note_path,
      integrations: {
        pointer: stored.pointer !== false,
        mcpJson: stored.mcpJson === true,
        sessionHook: stored.sessionHook === true,
        agentsMd: stored.agentsMd === true
      },
      remote: stored.remote ?? null,
      createdAt: row.created_at,
      pointerPresent: existsSync(join(row.path, '.sge-kb.json'))
    }
  }

  async link(input: KbRepoLinkInput): Promise<{ link: KbRepoLink; plan: KbRepoLinkPlanItem[] }> {
    const target = await this.buildTarget(input)
    if (target.localVault && !existsSync(target.noteAbsolutePath)) {
      if (!input.createNote) throw new Error(`The note does not exist: ${target.notePath}. Create it or pick another one.`)
      const remote = await originUrl(target.repoPath)
      await this.kb.createNote(
        target.spaceId,
        target.notePath,
        noteTemplate(basename(target.repoPath), remote, input.language ?? 'es'),
        { source: 'ui', tool: 'link-repo' }
      )
    }
    this.repos.upsertByPath(target.repoPath)
    const repo = this.repos.getRowByPath(target.repoPath)
    if (!repo) throw new Error('Could not register the repository')
    const previous = this.rowFor(repo.id)
    const previousState = previous ? ((JSON.parse(previous.integrations) as StoredIntegrations).state ?? null) : null
    const { plan, state } = await applyLink(target, previousState)
    const stored: StoredIntegrations = { ...input.integrations, state, remote: input.remote ?? null }
    getDb()
      .prepare(
        `INSERT INTO kb_repo_links (repo_id, space_id, note_path, integrations) VALUES (?, ?, ?, ?)
         ON CONFLICT(repo_id) DO UPDATE SET space_id = excluded.space_id, note_path = excluded.note_path, integrations = excluded.integrations`
      )
      .run(repo.id, target.spaceId, target.notePath, JSON.stringify(stored))
    if (target.localVault) {
      const remote = normalizeRemoteUrl((await originUrl(target.repoPath)) ?? '')
      if (remote) {
        upsertRegistry(target.vaultPath, { remote, note: target.notePath, name: basename(target.repoPath) })
        await this.kb.ensureIndex(target.spaceId).then((index) => index.updateFile('.sge-kb/repos.json')).catch(() => undefined)
      }
    }
    return { link: this.toLink(this.rowFor(repo.id)!), plan }
  }

  async unlink(repoId: string, options: { forgetInVault?: boolean } = {}): Promise<KbRepoLinkPlanItem[]> {
    const row = this.rowFor(repoId)
    if (!row) throw new Error('This repository is not linked')
    const stored = JSON.parse(row.integrations || '{}') as StoredIntegrations
    const items = existsSync(row.path) ? await removeLink(row.path, stored.state ?? { created: [], excluded: [] }) : []
    getDb().prepare('DELETE FROM kb_repo_links WHERE repo_id = ?').run(repoId)
    if (options.forgetInVault && !stored.remote) {
      try {
        const remote = normalizeRemoteUrl((await originUrl(row.path)) ?? '')
        if (remote) removeFromRegistry(this.kb.rootPathOf(row.space_id), remote)
      } catch {
        return items
      }
    }
    return items
  }

  get(repoId: string): KbRepoLink | null {
    const row = this.rowFor(repoId)
    return row ? this.toLink(row) : null
  }

  list(): KbRepoLink[] {
    const rows = getDb()
      .prepare('SELECT l.*, r.path FROM kb_repo_links l JOIN repos r ON r.id = l.repo_id ORDER BY r.path')
      .all() as LinkRow[]
    return rows.map((r) => this.toLink(r))
  }

  async suggestions(): Promise<KbRepoSuggestion[]> {
    const linked = new Set(this.list().map((l) => l.repoId))
    const repos = getDb().prepare('SELECT id, path FROM repos').all() as Array<{ id: string; path: string }>
    const registries = this.kb.listSpaces().flatMap((space) => {
      try {
        return readRegistry(this.kb.rootPathOf(space.id)).map((e) => ({ ...e, spaceId: space.id }))
      } catch {
        return []
      }
    })
    if (registries.length === 0) return []
    const out: KbRepoSuggestion[] = []
    for (const repo of repos) {
      if (linked.has(repo.id) || !existsSync(repo.path)) continue
      const url = await originUrl(repo.path)
      const key = url ? normalizeRemoteUrl(url) : null
      const match = key ? registries.find((r) => r.remote === key) : undefined
      if (match && url) out.push({ repoId: repo.id, repoPath: repo.path, remoteUrl: url, spaceId: match.spaceId, notePath: match.note })
    }
    return out
  }

  async context(repoPath: string, allowed: (spaceId: string) => boolean = () => true): Promise<KbRepoContext> {
    const top = await repoTopLevel(resolve(repoPath))
    const repo = this.repos.getRowByPath(top)
    const row = repo ? this.rowFor(repo.id) : null
    let spaceId = row?.space_id ?? null
    let notePath = row?.note_path ?? null
    if (!spaceId || !notePath) {
      const pointer = readPointer(top)
      if (pointer) {
        spaceId = pointer.spaceId
        notePath = pointer.note
      }
    }
    if (!spaceId || !notePath) {
      const key = normalizeRemoteUrl((await originUrl(top)) ?? '')
      if (key) {
        for (const space of this.kb.listSpaces()) {
          const hit = readRegistry(this.kb.rootPathOf(space.id)).find((e) => e.remote === key)
          if (hit) {
            spaceId = space.id
            notePath = hit.note
            break
          }
        }
      }
    }
    if (!spaceId || !notePath) {
      throw new Error(`No knowledge note is linked to ${top}. Link it from the repository page of the app.`)
    }
    if (!allowed(spaceId)) throw new Error('This token cannot read the space linked to that repository')
    const space = this.kb.getSpace(spaceId)
    const view = await this.kb.noteView(spaceId, notePath)
    return {
      repoPath: top.replace(/\\/g, '/'),
      spaceId,
      spaceName: space.name,
      notePath: view.path,
      title: view.title,
      hash: view.hash,
      content: view.content,
      links: view.outgoing
        .filter((l) => l.resolved && !l.embed)
        .map((l) => ({ path: l.resolved!.path, title: l.resolved!.title })),
      backlinks: view.backlinks.map((b) => ({ path: b.path, title: b.title }))
    }
  }
}
