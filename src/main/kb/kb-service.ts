import { existsSync, promises as fs, statSync } from 'fs'
import { basename, isAbsolute, relative, resolve, sep } from 'path'
import { watch, type FSWatcher } from 'chokidar'
import log from 'electron-log'
import { getDb } from '../database/connection'
import { pushEvent } from '../events'
import { isCloudSyncedPath } from '../utils/errors'
import { SpaceIndex, hashContent } from './index/space-index'
import { SpaceFamily, type FamilyMember } from './family'
import { ensureSpaceMeta, readSpaceMeta, renameSpaceMeta } from './space-meta'
import { isHiddenSegment, normalizeRel, resolveInSpace, toRel } from './paths'
import { clearGitCredentials, hasGitCredential } from './git-credentials'
import { deleteSecret } from './secret-vault'
import { parseRemote } from '../../shared/kb/git-remote'
import * as writer from './note-writer'
import { isImagePath, extensionOf } from '../../shared/kb/wikilink'
import { fuseRrf } from './semantic/vector-store'
import type {
  KbAuditEntry,
  KbBackend,
  KbBackendConfig,
  KbLinkView,
  KbNoteView,
  KbOrigin,
  KbSearchHit,
  KbSearchOptions,
  KbSpace,
  KbSpaceInput,
  KbSyncReport,
  KbTreeNode
} from '../../shared/kb/types'

interface SpaceRow {
  id: string
  name: string
  local_path: string
  parent_id: string | null
  backend: string
  backend_config: string
  sync_interval_min: number
  sync_on_write: number
  auto_commit_external: number
  agent_write: number
  review_before_push: number
  shared: number
  encrypted: number
  last_sync_at: string | null
  last_sync_status: string | null
  created_at: string
}

export interface KbHooks {
  onLocalWrite: (spaceId: string, paths: string[], origin: KbOrigin) => void
  onExternalChange: (spaceId: string, paths: string[]) => void
  onSpacesChanged: () => void
  isLocked: (spaceId: string) => boolean
}

const MAX_ASSET_BYTES = 15 * 1024 * 1024

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf'
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export class KbService {
  private indexes = new Map<string, SpaceIndex>()
  private watchers = new Map<string, FSWatcher>()
  private families = new Map<string, SpaceFamily>()
  private pending = new Map<string, Set<string>>()
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private building = new Map<string, Promise<void>>()
  private hooks: KbHooks = {
    onLocalWrite: () => {},
    onExternalChange: () => {},
    onSpacesChanged: () => {},
    isLocked: () => false
  }

  private semantic: { ready: () => boolean; search: (query: string, options: KbSearchOptions) => Promise<KbSearchHit[]> } | null = null

  setHooks(hooks: Partial<KbHooks>): void {
    this.hooks = { ...this.hooks, ...hooks }
  }

  setSemantic(semantic: { ready: () => boolean; search: (query: string, options: KbSearchOptions) => Promise<KbSearchHit[]> }): void {
    this.semantic = semantic
  }

  private rows(): SpaceRow[] {
    return getDb().prepare('SELECT * FROM kb_spaces ORDER BY created_at, name').all() as SpaceRow[]
  }

  private row(id: string): SpaceRow {
    const row = getDb().prepare('SELECT * FROM kb_spaces WHERE id = ?').get(id) as SpaceRow | undefined
    if (!row) throw new Error(`Space not found: ${id}`)
    return row
  }

  private toSpace(row: SpaceRow): KbSpace {
    const index = this.indexes.get(row.id)
    const pending = getDb()
      .prepare("SELECT COUNT(*) AS n FROM kb_audit WHERE space_id = ? AND review_state = 'pending'")
      .get(row.id) as { n: number }
    const backendConfig = parseJson<KbBackendConfig>(row.backend_config, {})
    const usesToken = row.backend === 'git' && backendConfig.gitAuth === 'token'
    return {
      id: row.id,
      name: row.name,
      localPath: row.local_path.replace(/\\/g, '/'),
      parentId: row.parent_id,
      backend: row.backend as KbBackend,
      backendConfig,
      sync: {
        intervalMin: row.sync_interval_min,
        onWrite: row.sync_on_write === 1,
        autoCommitExternal: row.auto_commit_external === 1
      },
      agentWrite: row.agent_write === 1,
      reviewBeforePush: row.review_before_push === 1,
      shared: row.shared === 1,
      encrypted: row.encrypted === 1,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: parseJson<KbSyncReport | null>(row.last_sync_status, null),
      createdAt: row.created_at,
      exists: existsSync(row.local_path),
      cloudSynced: isCloudSyncedPath(row.local_path),
      stats: index ? index.stats() : null,
      pendingReview: pending.n,
      locked: row.encrypted === 1 && this.hooks.isLocked(row.id),
      gitCredential: usesToken ? (hasGitCredential(row.id, backendConfig.remoteUrl ?? '') ? 'stored' : 'missing') : null
    }
  }

  listSpaces(): KbSpace[] {
    return this.rows().map((r) => this.toSpace(r))
  }

  getSpace(id: string): KbSpace {
    return this.toSpace(this.row(id))
  }

  rootPathOf(id: string): string {
    return this.row(id).local_path
  }

  private ready: Promise<void> = Promise.resolve()

  whenReady(): Promise<void> {
    return this.ready
  }

  init(): Promise<void> {
    this.ready = this.loadAll()
    return this.ready
  }

  private async loadAll(): Promise<void> {
    for (const row of this.rows()) {
      if (!existsSync(row.local_path)) {
        log.warn(`Knowledge space folder missing: ${row.local_path}`)
        continue
      }
      await this.ensureIndex(row.id)
      this.startWatcher(row.id)
    }
  }

  async dispose(): Promise<void> {
    for (const timer of this.flushTimers.values()) clearTimeout(timer)
    await Promise.all([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
  }

  private familyMembers(): FamilyMember[] {
    return this.rows().map((r) => ({
      id: r.id,
      localPath: r.local_path,
      parentId: r.parent_id,
      shared: r.shared === 1,
      index: this.indexes.get(r.id)
    }))
  }

  private rootIdOf(id: string, rows = this.rows()): string {
    let current = rows.find((r) => r.id === id)
    const seen = new Set<string>()
    while (current?.parent_id && !seen.has(current.id)) {
      seen.add(current.id)
      const parent = rows.find((r) => r.id === current!.parent_id)
      if (!parent) break
      current = parent
    }
    return current?.id ?? id
  }

  familyOf(id: string): SpaceFamily {
    const rows = this.rows()
    const rootId = this.rootIdOf(id, rows)
    const cached = this.families.get(rootId)
    if (cached) return cached
    const members = this.familyMembers().filter((m) => this.rootIdOf(m.id, rows) === rootId)
    const family = new SpaceFamily(members)
    this.families.set(rootId, family)
    return family
  }

  private invalidateFamilies(): void {
    this.families.clear()
  }

  async ensureIndex(id: string): Promise<SpaceIndex> {
    const existing = this.indexes.get(id)
    if (existing) {
      const inFlight = this.building.get(id)
      if (inFlight) await inFlight
      return existing
    }
    const row = this.row(id)
    const index = new SpaceIndex(row.local_path)
    this.indexes.set(id, index)
    const job = (async () => {
      this.invalidateFamilies()
      index.setExcludedDirs(this.familyOf(id).childDirsOf(id))
      const started = Date.now()
      await index.build()
      log.info(`Indexed knowledge space ${row.name}: ${index.notes.size} notes in ${Date.now() - started} ms`)
      this.invalidateFamilies()
    })()
    this.building.set(id, job)
    try {
      await job
    } finally {
      this.building.delete(id)
    }
    return index
  }

  async reindex(id: string): Promise<KbSpace> {
    this.indexes.delete(id)
    this.invalidateFamilies()
    await this.ensureIndex(id)
    this.emitChanged(id, [])
    return this.getSpace(id)
  }

  private startWatcher(id: string): void {
    if (this.watchers.has(id)) return
    const row = this.row(id)
    const root = row.local_path
    const watcher = watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      ignored: (path: string) => {
        const rel = toRel(root, path)
        if (rel === '' || rel.startsWith('..')) return false
        if (isHiddenSegment(rel)) return true
        const index = this.indexes.get(id)
        return index ? !index.isIndexable(rel) : false
      }
    })
    const enqueue = (path: string): void => {
      const rel = toRel(root, path)
      if (!rel || rel.startsWith('..')) return
      const set = this.pending.get(id) ?? new Set<string>()
      set.add(rel)
      this.pending.set(id, set)
      const timer = this.flushTimers.get(id)
      if (timer) clearTimeout(timer)
      this.flushTimers.set(
        id,
        setTimeout(() => void this.flush(id), 300)
      )
    }
    watcher.on('add', enqueue).on('change', enqueue).on('unlink', enqueue).on('unlinkDir', enqueue).on('addDir', enqueue)
    watcher.on('error', (error) => log.warn(`Knowledge watcher error in ${root}:`, error))
    this.watchers.set(id, watcher)
  }

  private async stopWatcher(id: string): Promise<void> {
    const watcher = this.watchers.get(id)
    if (!watcher) return
    this.watchers.delete(id)
    await watcher.close()
  }

  private async flush(id: string): Promise<void> {
    this.flushTimers.delete(id)
    const paths = [...(this.pending.get(id) ?? [])]
    this.pending.delete(id)
    if (paths.length === 0) return
    const index = this.indexes.get(id)
    if (!index) return
    const changed: string[] = []
    let structural = false
    for (const path of paths) {
      try {
        const result = await index.updateFile(path)
        if (result !== 'unchanged' && result !== 'skipped') changed.push(path)
        if (result === 'added' || result === 'removed') structural = true
      } catch (error) {
        log.warn(`Could not index ${path}:`, error)
      }
    }
    if (changed.length === 0) return
    const family = this.familyOf(id)
    if (structural) this.invalidateFamilies()
    else family.invalidate()
    this.emitChanged(id, changed)
    this.hooks.onExternalChange(id, changed)
  }

  emitChanged(spaceId: string, paths: string[]): void {
    pushEvent('kb:changed', { spaceId, paths })
  }

  private validateNewSpacePath(localPath: string): string {
    if (!isAbsolute(localPath)) throw new Error(`Use an absolute path: ${localPath}`)
    const full = resolve(localPath)
    if (!existsSync(full) || !statSync(full).isDirectory()) throw new Error(`The folder does not exist: ${full}`)
    return full
  }

  private detectParent(full: string, rows: SpaceRow[]): SpaceRow | null {
    const containing = rows
      .filter((r) => isInside(r.local_path, full))
      .sort((a, b) => b.local_path.length - a.local_path.length)
    return containing[0] ?? null
  }

  async addSpace(input: KbSpaceInput): Promise<KbSpace> {
    const full = this.validateNewSpacePath(input.localPath)
    const rows = this.rows()
    if (rows.some((r) => resolve(r.local_path) === full)) throw new Error(`This folder is already a space: ${full}`)
    if (rows.some((r) => isInside(full, r.local_path))) {
      throw new Error('A space already exists inside this folder. Add the outer folder first, then nest the inner one.')
    }
    const backend = input.backend ?? 'none'
    if ((backend === 'git' || input.backendConfig?.remoteUrl) && isCloudSyncedPath(full)) {
      throw new Error(
        'This folder is inside a cloud-synced folder (Synology Drive, Dropbox, iCloud...). Git breaks there. Move the space to a local folder first.'
      )
    }
    if (backend === 'git' && input.backendConfig?.remoteUrl) parseRemote(input.backendConfig.remoteUrl)
    const detected = this.detectParent(full, rows)
    const parentId = input.parentId === undefined ? (detected?.id ?? null) : input.parentId
    if (parentId) {
      const parent = rows.find((r) => r.id === parentId)
      if (!parent || !isInside(parent.local_path, full)) {
        throw new Error('A nested space must live inside the folder of its parent space.')
      }
    }
    const name = (input.name || readSpaceMeta(full)?.name || basename(full)).trim()
    const meta = ensureSpaceMeta(full, name)
    if (rows.some((r) => r.id === meta.id)) {
      throw new Error('This folder has the identity of a space that is already registered (a copy?).')
    }
    getDb()
      .prepare(
        `INSERT INTO kb_spaces (id, name, local_path, parent_id, backend, backend_config, sync_interval_min,
          sync_on_write, auto_commit_external, agent_write, review_before_push, shared)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        meta.id,
        name,
        full,
        parentId,
        backend,
        JSON.stringify(input.backendConfig ?? {}),
        input.sync?.intervalMin ?? 0,
        input.sync?.onWrite ? 1 : 0,
        input.sync?.autoCommitExternal ? 1 : 0,
        input.agentWrite === false ? 0 : 1,
        (input.reviewBeforePush ?? input.shared) ? 1 : 0,
        input.shared ? 1 : 0
      )
    this.invalidateFamilies()
    if (parentId) await this.reindex(parentId)
    await this.ensureIndex(meta.id)
    this.startWatcher(meta.id)
    this.hooks.onSpacesChanged()
    return this.getSpace(meta.id)
  }

  async updateSpace(id: string, patch: Partial<KbSpaceInput>): Promise<KbSpace> {
    const row = this.row(id)
    const sets: string[] = []
    const values: unknown[] = []
    const set = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new Error('The space needs a name')
      set('name', name)
      renameSpaceMeta(row.local_path, name)
    }
    if (patch.backend !== undefined) {
      if (patch.backend === 'git' && isCloudSyncedPath(row.local_path)) {
        throw new Error('Git cannot be used inside a cloud-synced folder. Move the space to a local folder first.')
      }
      set('backend', patch.backend)
    }
    if ((patch.backend ?? row.backend) === 'git' && patch.backendConfig?.remoteUrl) parseRemote(patch.backendConfig.remoteUrl)
    if (patch.backendConfig !== undefined) set('backend_config', JSON.stringify(patch.backendConfig))
    if (patch.sync?.intervalMin !== undefined) set('sync_interval_min', Math.max(0, Math.floor(patch.sync.intervalMin)))
    if (patch.sync?.onWrite !== undefined) set('sync_on_write', patch.sync.onWrite ? 1 : 0)
    if (patch.sync?.autoCommitExternal !== undefined) set('auto_commit_external', patch.sync.autoCommitExternal ? 1 : 0)
    if (patch.agentWrite !== undefined) set('agent_write', patch.agentWrite ? 1 : 0)
    if (patch.reviewBeforePush !== undefined) set('review_before_push', patch.reviewBeforePush ? 1 : 0)
    if (patch.shared !== undefined) set('shared', patch.shared ? 1 : 0)
    if (sets.length > 0) {
      getDb().prepare(`UPDATE kb_spaces SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
      this.invalidateFamilies()
      this.hooks.onSpacesChanged()
    }
    return this.getSpace(id)
  }

  setEncryptedFlag(id: string, encrypted: boolean): void {
    getDb().prepare('UPDATE kb_spaces SET encrypted = ? WHERE id = ?').run(encrypted ? 1 : 0, id)
  }

  recordSync(id: string, report: KbSyncReport): void {
    getDb()
      .prepare('UPDATE kb_spaces SET last_sync_at = ?, last_sync_status = ? WHERE id = ?')
      .run(report.at, JSON.stringify(report), id)
  }

  async removeSpace(id: string): Promise<void> {
    const row = this.row(id)
    await this.stopWatcher(id)
    this.indexes.delete(id)
    getDb().prepare('UPDATE kb_spaces SET parent_id = ? WHERE parent_id = ?').run(row.parent_id, id)
    getDb().prepare('DELETE FROM kb_spaces WHERE id = ?').run(id)
    clearGitCredentials(id)
    deleteSecret(`sftp:${id}`)
    this.invalidateFamilies()
    if (row.parent_id) await this.reindex(row.parent_id)
    this.hooks.onSpacesChanged()
  }

  async relocateSpace(id: string, targetPath: string): Promise<KbSpace> {
    const row = this.row(id)
    if (!isAbsolute(targetPath)) throw new Error(`Use an absolute path: ${targetPath}`)
    const target = resolve(targetPath)
    if (existsSync(target) && (await fs.readdir(target)).length > 0) {
      throw new Error(`The destination is not empty: ${target}`)
    }
    if (isCloudSyncedPath(target)) throw new Error('The destination is also inside a cloud-synced folder.')
    if (this.rows().some((r) => r.parent_id === id)) {
      throw new Error('Move nested spaces out first: relocating a parent with children is not supported.')
    }
    await this.stopWatcher(id)
    await fs.cp(row.local_path, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
    getDb().prepare('UPDATE kb_spaces SET local_path = ?, parent_id = NULL WHERE id = ?').run(target, id)
    this.indexes.delete(id)
    this.invalidateFamilies()
    await this.ensureIndex(id)
    this.startWatcher(id)
    this.hooks.onSpacesChanged()
    return this.getSpace(id)
  }

  private async indexFor(id: string): Promise<SpaceIndex> {
    this.row(id)
    return this.ensureIndex(id)
  }

  async tree(id: string, includeFiles = false): Promise<KbTreeNode> {
    return (await this.indexFor(id)).tree({ includeFiles })
  }

  async readRaw(id: string, path: string): Promise<{ content: string; hash: string; absolutePath: string }> {
    const root = this.rootPathOf(id)
    const rel = normalizeRel(path)
    const full = resolveInSpace(root, rel)
    const data = await fs.readFile(full)
    return { content: data.toString('utf-8'), hash: hashContent(data), absolutePath: full }
  }

  async noteView(id: string, path: string): Promise<KbNoteView> {
    const index = await this.indexFor(id)
    const rel = normalizeRel(path)
    await index.updateFile(rel)
    const note = index.notes.get(rel)
    if (!note) throw new Error(`Note not found: ${rel}`)
    const raw = await this.readRaw(id, rel)
    const family = this.familyOf(id)
    const title = (spaceId: string, p: string): string =>
      this.indexes.get(spaceId)?.notes.get(p)?.title ?? p.slice(p.lastIndexOf('/') + 1)
    const outgoing: KbLinkView[] = note.links.map((link) => {
      const located = link.target ? family.resolve(id, rel, link.target) : { spaceId: id, path: rel }
      return {
        target: link.target,
        heading: link.heading,
        alias: link.alias,
        embed: link.embed,
        line: link.line,
        resolved: located ? { ...located, title: title(located.spaceId, located.path) } : null,
        crossesToPrivate: located ? family.crossesToPrivate(id, located.spaceId) : false
      }
    })
    const backlinks = family.backlinks(id, rel).map((b) => ({ ...b, title: title(b.spaceId, b.path) }))
    const bodyMatch = raw.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
    return {
      spaceId: id,
      path: rel,
      absolutePath: raw.absolutePath.replace(/\\/g, '/'),
      title: note.title,
      content: raw.content,
      body: bodyMatch ? raw.content.slice(bodyMatch[0].length) : raw.content,
      frontmatter: note.frontmatter,
      frontmatterError: note.frontmatterError,
      tags: note.tags,
      headings: note.headings,
      outgoing,
      backlinks,
      hash: raw.hash,
      mtimeMs: note.mtimeMs,
      size: note.size
    }
  }

  async resolveLink(id: string, fromPath: string, target: string): Promise<{ spaceId: string; path: string } | null> {
    await this.indexFor(id)
    return this.familyOf(id).resolve(id, normalizeRel(fromPath), target)
  }

  async readAsset(id: string, fromPath: string, target: string): Promise<{ mime: string; dataUrl: string; spaceId: string; path: string }> {
    const located = await this.resolveLink(id, fromPath, target)
    if (!located) throw new Error(`Attachment not found: ${target}`)
    const ext = extensionOf(located.path)
    const mime = MIME[ext]
    if (!mime || (!isImagePath(located.path) && ext !== '.pdf')) throw new Error(`Not an embeddable file: ${located.path}`)
    const full = resolveInSpace(this.rootPathOf(located.spaceId), located.path)
    const stat = await fs.stat(full)
    if (stat.size > MAX_ASSET_BYTES) throw new Error(`Attachment too large to preview: ${located.path}`)
    const data = await fs.readFile(full)
    return { mime, dataUrl: `data:${mime};base64,${data.toString('base64')}`, ...located }
  }

  async search(query: string, options: KbSearchOptions = {}): Promise<KbSearchHit[]> {
    const limit = options.limit ?? 20
    const semanticReady = this.semantic?.ready() ?? false
    const mode = options.mode ?? (semanticReady ? 'hybrid' : 'text')
    if (mode === 'semantic') {
      if (!this.semantic) throw new Error('Semantic search is not available')
      return this.semantic.search(query, options)
    }
    const text = await this.textSearch(query, { ...options, limit: mode === 'hybrid' ? limit * 2 : limit })
    if (mode !== 'hybrid' || !this.semantic || !semanticReady) return text.slice(0, limit)
    const semantic = await this.semantic.search(query, { ...options, limit: limit * 2 }).catch(() => [])
    return fuseRrf([text, semantic])
      .slice(0, limit)
      .map(({ item, score, sources }) => {
        const fromText = text.find((h) => h.spaceId === item.spaceId && h.path === item.path)
        const fromSemantic = semantic.find((h) => h.spaceId === item.spaceId && h.path === item.path)
        return {
          ...(fromText ?? item),
          heading: fromSemantic?.heading ?? fromText?.heading,
          score,
          matchedBy: sources.map((s) => (s === 0 ? 'text' : 'semantic') as 'text' | 'semantic')
        }
      })
  }

  private async textSearch(query: string, options: KbSearchOptions): Promise<KbSearchHit[]> {
    const limit = options.limit ?? 20
    const ids = options.spaceIds && options.spaceIds.length > 0 ? options.spaceIds : this.rows().map((r) => r.id)
    const hits: KbSearchHit[] = []
    for (const id of ids) {
      if (!this.rows().some((r) => r.id === id) || !existsSync(this.rootPathOf(id))) continue
      const index = await this.ensureIndex(id)
      for (const hit of index.search(query, { folder: options.folder, tags: options.tags, limit })) {
        hits.push({ ...hit, spaceId: id, matchedBy: ['text'] })
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  async recent(options: { spaceIds?: string[]; limit?: number; folder?: string } = {}): Promise<
    Array<{ spaceId: string; path: string; title: string; mtime: string; tags: string[] }>
  > {
    const ids = options.spaceIds && options.spaceIds.length > 0 ? options.spaceIds : this.rows().map((r) => r.id)
    const out: Array<{ spaceId: string; path: string; title: string; mtimeMs: number; tags: string[] }> = []
    for (const id of ids) {
      if (!existsSync(this.rootPathOf(id))) continue
      const index = await this.ensureIndex(id)
      for (const note of index.recent(options.limit ?? 20, options.folder)) {
        out.push({ spaceId: id, path: note.path, title: note.title, mtimeMs: note.mtimeMs, tags: note.tags })
      }
    }
    return out
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, options.limit ?? 20)
      .map(({ mtimeMs, ...rest }) => ({ ...rest, mtime: new Date(mtimeMs).toISOString() }))
  }

  async tags(spaceIds?: string[]): Promise<Array<{ tag: string; count: number }>> {
    const ids = spaceIds && spaceIds.length > 0 ? spaceIds : this.rows().map((r) => r.id)
    const counts = new Map<string, number>()
    for (const id of ids) {
      if (!existsSync(this.rootPathOf(id))) continue
      for (const { tag, count } of (await this.ensureIndex(id)).tags()) counts.set(tag, (counts.get(tag) ?? 0) + count)
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
  }

  async listFolder(id: string, folder: string): Promise<Array<{ path: string; type: 'folder' | 'note' | 'file'; title?: string }>> {
    const tree = await this.tree(id, true)
    const clean = normalizeRel(folder || '')
    let node: KbTreeNode | undefined = tree
    if (clean) {
      for (const part of clean.split('/')) {
        node = node?.children?.find((c) => c.type === 'folder' && c.name === part)
        if (!node) throw new Error(`Folder not found: ${clean}`)
      }
    }
    return (node?.children ?? []).map((c) => ({ path: c.path, type: c.type, title: c.title }))
  }

  private ensureWritable(id: string, origin: KbOrigin): SpaceRow {
    const row = this.row(id)
    if (origin.source === 'mcp' && row.agent_write !== 1) {
      throw new Error('Assistants cannot write in this space. The owner turned it off in the space settings.')
    }
    return row
  }

  private audit(id: string, origin: KbOrigin, result: writer.WriteResult): void {
    const row = this.row(id)
    const review = origin.source === 'mcp' && row.review_before_push === 1 ? 'pending' : null
    getDb()
      .prepare(
        `INSERT INTO kb_audit (source, token_name, tool, space_id, path, hash_before, hash_after, before_content, review_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        origin.source,
        origin.tokenName ?? null,
        origin.tool ?? null,
        id,
        result.path,
        result.hashBefore,
        result.hashAfter,
        result.before,
        review
      )
  }

  private async afterWrite(id: string, origin: KbOrigin, result: writer.WriteResult): Promise<void> {
    this.audit(id, origin, result)
    const index = await this.ensureIndex(id)
    const outcome = await index.updateFile(result.path)
    if (outcome === 'added' || outcome === 'removed') this.invalidateFamilies()
    else this.familyOf(id).invalidate()
    this.emitChanged(id, [result.path])
    pushEvent('app:data-changed', { source: origin.source, tool: origin.tool ?? 'kb' })
    this.hooks.onLocalWrite(id, [result.path], origin)
  }

  async createNote(id: string, path: string, content: string, origin: KbOrigin): Promise<writer.WriteResult> {
    const row = this.ensureWritable(id, origin)
    const result = await writer.createNote(row.local_path, path, content)
    await this.afterWrite(id, origin, result)
    return result
  }

  async replaceInNote(id: string, path: string, oldText: string, newText: string, expectedHash: string | undefined, origin: KbOrigin): Promise<writer.WriteResult> {
    const row = this.ensureWritable(id, origin)
    const result = await writer.replaceInNote(row.local_path, path, oldText, newText, expectedHash)
    await this.afterWrite(id, origin, result)
    return result
  }

  async appendToNote(id: string, path: string, content: string, expectedHash: string | undefined, origin: KbOrigin): Promise<writer.WriteResult> {
    const row = this.ensureWritable(id, origin)
    const result = await writer.appendToNote(row.local_path, path, content, expectedHash)
    await this.afterWrite(id, origin, result)
    return result
  }

  async patchSection(
    id: string,
    path: string,
    heading: string,
    content: string,
    mode: 'replace' | 'append' | 'prepend',
    expectedHash: string | undefined,
    origin: KbOrigin
  ): Promise<writer.WriteResult> {
    const row = this.ensureWritable(id, origin)
    const result = await writer.patchSection(row.local_path, path, heading, content, mode, expectedHash)
    await this.afterWrite(id, origin, result)
    return result
  }

  async setFrontmatter(id: string, path: string, patch: Record<string, unknown>, expectedHash: string | undefined, origin: KbOrigin): Promise<writer.WriteResult> {
    const row = this.ensureWritable(id, origin)
    const result = await writer.setFrontmatter(row.local_path, path, patch, expectedHash)
    await this.afterWrite(id, origin, result)
    return result
  }

  async trashNote(id: string, path: string, expectedHash: string | undefined, origin: KbOrigin): Promise<writer.WriteResult & { trashPath: string }> {
    const row = this.ensureWritable(id, origin)
    const result = await writer.trashNote(row.local_path, path, expectedHash)
    await this.afterWrite(id, origin, result)
    return result
  }

  auditLog(spaceId: string | null, limit = 200): KbAuditEntry[] {
    const rows = (spaceId
      ? getDb().prepare('SELECT * FROM kb_audit WHERE space_id = ? ORDER BY id DESC LIMIT ?').all(spaceId, limit)
      : getDb().prepare('SELECT * FROM kb_audit ORDER BY id DESC LIMIT ?').all(limit)) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as string,
      source: r.source as string,
      tokenName: (r.token_name as string) ?? null,
      tool: (r.tool as string) ?? null,
      spaceId: r.space_id as string,
      path: r.path as string,
      hashBefore: (r.hash_before as string) ?? null,
      hashAfter: (r.hash_after as string) ?? null,
      reviewState: (r.review_state as KbAuditEntry['reviewState']) ?? null
    }))
  }

  pendingReview(spaceId: string): KbAuditEntry[] {
    return this.auditLog(spaceId, 1000).filter((e) => e.reviewState === 'pending')
  }

  approveReview(spaceId: string, ids: number[] | 'all'): number {
    const db = getDb()
    if (ids === 'all') {
      return db
        .prepare("UPDATE kb_audit SET review_state = 'approved' WHERE space_id = ? AND review_state = 'pending'")
        .run(spaceId).changes
    }
    const stmt = db.prepare("UPDATE kb_audit SET review_state = 'approved' WHERE id = ? AND space_id = ? AND review_state = 'pending'")
    let n = 0
    for (const id of ids) n += stmt.run(id, spaceId).changes
    return n
  }

  async revertReview(spaceId: string, auditId: number): Promise<void> {
    const db = getDb()
    const row = db.prepare('SELECT * FROM kb_audit WHERE id = ? AND space_id = ?').get(auditId, spaceId) as
      | { path: string; before_content: Buffer | null; hash_after: string | null; review_state: string | null }
      | undefined
    if (!row || row.review_state !== 'pending') throw new Error('This change is not waiting for review')
    const later = db
      .prepare("SELECT COUNT(*) AS n FROM kb_audit WHERE space_id = ? AND path = ? AND id > ? AND review_state = 'pending'")
      .get(spaceId, row.path, auditId) as { n: number }
    if (later.n > 0) throw new Error('A later change to the same note is pending. Revert that one first.')
    const root = this.rootPathOf(spaceId)
    await writer.restoreContent(root, row.path, row.before_content)
    db.prepare("UPDATE kb_audit SET review_state = 'reverted' WHERE id = ?").run(auditId)
    const index = await this.ensureIndex(spaceId)
    await index.updateFile(row.path)
    this.invalidateFamilies()
    this.emitChanged(spaceId, [row.path])
  }

  async reviewDiff(spaceId: string, auditId: number): Promise<{ path: string; before: string; after: string }> {
    const row = getDb().prepare('SELECT * FROM kb_audit WHERE id = ? AND space_id = ?').get(auditId, spaceId) as
      | { path: string; before_content: Buffer | null }
      | undefined
    if (!row) throw new Error('Change not found')
    let after = ''
    try {
      after = (await this.readRaw(spaceId, row.path)).content
    } catch {
      after = ''
    }
    return { path: row.path, before: row.before_content ? row.before_content.toString('utf-8') : '', after }
  }

  relPathIfInsideSpace(absolutePath: string): { spaceId: string; path: string } | null {
    const full = resolve(absolutePath)
    const candidates = this.rows()
      .filter((r) => full === resolve(r.local_path) || isInside(r.local_path, full))
      .sort((a, b) => b.local_path.length - a.local_path.length)
    const row = candidates[0]
    if (!row) return null
    return { spaceId: row.id, path: relative(row.local_path, full).split(sep).join('/') }
  }
}
