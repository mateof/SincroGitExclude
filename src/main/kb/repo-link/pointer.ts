import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, rmdirSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { execGit } from '../../git/git-exec'
import { GitExcludeService } from '../../git/git-exclude'
import type { KbRepoIntegrations, KbRepoLinkPlanItem } from '../../../shared/kb/types'

export const POINTER_FILE = '.sge-kb.json'
export const MCP_FILE = '.mcp.json'
export const SETTINGS_FILE = '.claude/settings.local.json'
export const AGENTS_FILE = 'AGENTS.md'
export const MCP_SERVER_NAME = 'sincrogitexclude-kb'
export const TOKEN_ENV = 'SGE_KB_TOKEN'
export const EXCLUDE_MARKER_ID = 'kb'
const BLOCK_START = '<!-- sge-kb:start -->'
const BLOCK_END = '<!-- sge-kb:end -->'
const HOOK_MARKER = 'SincroGitExclude knowledge base'

export interface LinkTarget {
  repoPath: string
  spaceId: string
  spaceName: string
  vaultPath: string
  notePath: string
  noteAbsolutePath: string
  mcpUrl: string
  localVault: boolean
  userLevelMcp: boolean
  integrations: KbRepoIntegrations
}

export interface LinkState {
  created: string[]
  excluded: string[]
}

export interface PlannedLink {
  items: KbRepoLinkPlanItem[]
  files: Map<string, string>
  deletions: string[]
}

async function isTracked(repo: string, rel: string): Promise<boolean> {
  try {
    await execGit(['ls-files', '--error-unmatch', '--', rel], { cwd: repo })
    return true
  } catch {
    return false
  }
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it by hand before linking.`)
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function sessionHookCommand(target: LinkTarget): string {
  const header = `printf '%s\\n' '# ${HOOK_MARKER}: ${target.notePath.replace(/'/g, '')}'`
  if (target.localVault) {
    return `${header}; cat ${shellQuote(target.noteAbsolutePath.replace(/\\/g, '/'))} 2>/dev/null || true`
  }
  const url = `${target.mcpUrl.replace(/\/mcp$/, '')}/kb/context?space=${encodeURIComponent(target.spaceId)}&note=${encodeURIComponent(target.notePath)}`
  return `${header}; curl -fsS -H "Authorization: Bearer $${TOKEN_ENV}" ${shellQuote(url)} 2>/dev/null || true`
}

function agentsBlock(target: LinkTarget): string {
  return [
    BLOCK_START,
    '## Knowledge base',
    '',
    'The project note of this repository lives in the knowledge base managed by SincroGitExclude.',
    '',
    `- Space: ${target.spaceName} (\`${target.spaceId}\`)`,
    `- Note: \`${target.notePath}\``,
    target.localVault ? `- File: \`${target.noteAbsolutePath.replace(/\\/g, '/')}\`` : `- Remote: ${target.mcpUrl}`,
    '',
    'Read it at the start of a task (MCP tool `kb_repo_context` with the path of this repository, or the file above) and update it when you finish meaningful work.',
    BLOCK_END
  ].join('\n')
}

function stripBlock(text: string): string {
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  if (start < 0 || end < start) return text
  const before = text.slice(0, start).replace(/\n+$/, '')
  const after = text.slice(end + BLOCK_END.length).replace(/^\n+/, '')
  return before && after ? `${before}\n\n${after}` : before || after
}

function upsertBlock(text: string, block: string): string {
  const base = stripBlock(text).replace(/\n+$/, '')
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}

function isOurHook(entry: unknown): boolean {
  const hooks = (entry as { hooks?: Array<{ command?: string }> } | null)?.hooks
  return Array.isArray(hooks) && hooks.some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER))
}

export async function planLink(target: LinkTarget): Promise<PlannedLink> {
  const repo = target.repoPath
  const items: KbRepoLinkPlanItem[] = []
  const files = new Map<string, string>()
  const { integrations } = target

  const consider = async (rel: string, wanted: boolean, build: (current: string | null) => string, skipWhy?: string): Promise<void> => {
    if (!wanted) return
    if (skipWhy) {
      items.push({ file: rel, action: 'skip', reason: skipWhy })
      return
    }
    if (await isTracked(repo, rel)) {
      items.push({ file: rel, action: 'skip', reason: 'tracked by git in this repository, left untouched' })
      return
    }
    const full = join(repo, ...rel.split('/'))
    const current = existsSync(full) ? readFileSync(full, 'utf-8') : null
    const next = build(current)
    if (current === next) {
      items.push({ file: rel, action: 'skip', reason: 'already up to date' })
      return
    }
    files.set(rel, next)
    items.push({ file: rel, action: current === null ? 'create' : 'update' })
  }

  await consider(POINTER_FILE, integrations.pointer, () =>
    JSON.stringify(
      {
        version: 1,
        spaceId: target.spaceId,
        spaceName: target.spaceName,
        vaultPath: target.localVault ? target.vaultPath.replace(/\\/g, '/') : null,
        note: target.notePath,
        noteAbsolutePath: target.localVault ? target.noteAbsolutePath.replace(/\\/g, '/') : null,
        mcp: { url: target.mcpUrl, server: MCP_SERVER_NAME, tool: 'kb_repo_context' }
      },
      null,
      2
    ) + '\n'
  )

  await consider(
    MCP_FILE,
    integrations.mcpJson,
    (current) => {
      const parsed = current ? (readJson(join(repo, MCP_FILE)) ?? {}) : {}
      const servers = { ...((parsed.mcpServers as Record<string, unknown>) ?? {}) }
      servers[MCP_SERVER_NAME] = {
        type: 'http',
        url: target.mcpUrl,
        headers: { Authorization: `Bearer \${${TOKEN_ENV}}` }
      }
      return JSON.stringify({ ...parsed, mcpServers: servers }, null, 2) + '\n'
    },
    target.userLevelMcp ? 'the SincroGitExclude MCP is already configured for your user, a second copy would duplicate its tools' : undefined
  )

  await consider(SETTINGS_FILE, integrations.sessionHook, (current) => {
    const parsed = current ? (readJson(join(repo, ...SETTINGS_FILE.split('/'))) ?? {}) : {}
    const hooks = { ...((parsed.hooks as Record<string, unknown>) ?? {}) }
    const sessionStart = (Array.isArray(hooks.SessionStart) ? hooks.SessionStart : []).filter((e) => !isOurHook(e))
    sessionStart.push({ hooks: [{ type: 'command', command: sessionHookCommand(target) }] })
    hooks.SessionStart = sessionStart
    return JSON.stringify({ ...parsed, hooks }, null, 2) + '\n'
  })

  await consider(AGENTS_FILE, integrations.agentsMd, (current) => upsertBlock(current ?? '', agentsBlock(target)))

  return { items, files, deletions: [] }
}

export async function applyLink(target: LinkTarget, previous: LinkState | null): Promise<{ plan: KbRepoLinkPlanItem[]; state: LinkState }> {
  const plan = await planLink(target)
  const exclude = new GitExcludeService()
  const state: LinkState = { created: [...(previous?.created ?? [])], excluded: [...(previous?.excluded ?? [])] }
  for (const [rel, content] of plan.files) {
    const full = join(target.repoPath, ...rel.split('/'))
    if (!existsSync(full) && !state.created.includes(rel)) state.created.push(rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
    if (!(await exclude.isExcluded(target.repoPath, rel))) {
      await exclude.addExclusion(target.repoPath, rel, EXCLUDE_MARKER_ID)
      if (!state.excluded.includes(rel)) state.excluded.push(rel)
    }
  }
  return { plan: plan.items, state }
}

function removeEmptyDirs(repo: string, rel: string): void {
  let dir = dirname(join(repo, ...rel.split('/')))
  while (dir.startsWith(repo) && dir !== repo) {
    try {
      if (readdirSync(dir).length > 0) break
      rmdirSync(dir)
    } catch {
      break
    }
    dir = dirname(dir)
  }
}

export async function removeLink(repoPath: string, state: LinkState): Promise<KbRepoLinkPlanItem[]> {
  const items: KbRepoLinkPlanItem[] = []
  const exclude = new GitExcludeService()
  const touch = async (rel: string, transform: (text: string) => string | null): Promise<void> => {
    const full = join(repoPath, ...rel.split('/'))
    if (!existsSync(full)) return
    if (await isTracked(repoPath, rel)) {
      items.push({ file: rel, action: 'skip', reason: 'tracked by git, left untouched' })
      return
    }
    const next = transform(readFileSync(full, 'utf-8'))
    if (next === null || (state.created.includes(rel) && next.trim() === '')) {
      rmSync(full, { force: true })
      removeEmptyDirs(repoPath, rel)
      items.push({ file: rel, action: 'remove' })
      if (state.excluded.includes(rel)) await exclude.removeExclusion(repoPath, rel, EXCLUDE_MARKER_ID)
    } else {
      writeFileSync(full, next, 'utf-8')
      items.push({ file: rel, action: 'update' })
    }
  }
  await touch(POINTER_FILE, () => null)
  await touch(MCP_FILE, (text) => {
    const parsed = JSON.parse(text) as { mcpServers?: Record<string, unknown> }
    if (parsed.mcpServers) delete parsed.mcpServers[MCP_SERVER_NAME]
    const empty = !parsed.mcpServers || Object.keys(parsed.mcpServers).length === 0
    if (empty && Object.keys(parsed).filter((k) => k !== 'mcpServers').length === 0 && state.created.includes(MCP_FILE)) return null
    return JSON.stringify(parsed, null, 2) + '\n'
  })
  await touch(SETTINGS_FILE, (text) => {
    const parsed = JSON.parse(text) as { hooks?: Record<string, unknown> }
    const hooks = parsed.hooks ?? {}
    const list = Array.isArray(hooks.SessionStart) ? hooks.SessionStart.filter((e) => !isOurHook(e)) : []
    if (list.length > 0) hooks.SessionStart = list
    else delete hooks.SessionStart
    if (Object.keys(hooks).length > 0) parsed.hooks = hooks
    else delete parsed.hooks
    if (Object.keys(parsed).length === 0 && state.created.includes(SETTINGS_FILE)) return null
    return JSON.stringify(parsed, null, 2) + '\n'
  })
  await touch(AGENTS_FILE, (text) => {
    const next = stripBlock(text)
    return next.trim() === '' && state.created.includes(AGENTS_FILE) ? null : next.endsWith('\n') || next === '' ? next : `${next}\n`
  })
  return items
}

export function readPointer(repoPath: string): { spaceId: string; note: string } | null {
  const full = join(repoPath, POINTER_FILE)
  if (!existsSync(full)) return null
  try {
    const parsed = JSON.parse(readFileSync(full, 'utf-8')) as { spaceId?: unknown; note?: unknown }
    if (typeof parsed.spaceId === 'string' && typeof parsed.note === 'string') return { spaceId: parsed.spaceId, note: parsed.note }
  } catch {
    return null
  }
  return null
}

export async function originUrl(repoPath: string): Promise<string | null> {
  try {
    const result = await execGit(['remote', 'get-url', 'origin'], { cwd: repoPath })
    return result.stdout.toString('utf-8').trim() || null
  } catch {
    return null
  }
}
