import log from 'electron-log'
import { existsSync } from 'fs'
import { getDb } from '../database/connection'
import { pushEvent } from '../events'
import { readSyncConfig } from '../sync/sync-config'
import type { KbService } from './kb-service'
import { emptyReport, ensureRepo, isRepoRoot, noteAt, noteDiff, noteHistory, syncGitSpace, commitAll, cloneSpace } from './sync/git-space'
import { syncThreeWay, type SyncState } from './sync/three-way'
import { FsStore } from './sync/fs-store'
import { SftpStore, probeSftp } from './sync/sftp-store'
import { RemoteLockedError, type RemoteStore } from './sync/remote-store'
import { getSecret } from './secret-vault'
import { getGitCredential, setGitCredential } from './git-credentials'
import { ghToken, probeRemote, sshKeyAuth, tokenAuth, type GitAuth, type GitCredential, type RemoteProbe } from './sync/git-auth'
import { defaultUsername, detectProvider, parseRemote } from '../../shared/kb/git-remote'
import { isCloudSyncedPath } from '../utils/errors'
import type { GitBackendConfig, KbBackendConfig, KbOrigin, KbSpace, KbSyncReport, SftpBackendConfig } from '../../shared/kb/types'

export interface EncryptionHooks {
  ensureUnlocked: (spaceId: string) => Promise<boolean>
  canPublish: (spaceId: string) => boolean
  wrapStore: (spaceId: string, raw: RemoteStore) => Promise<RemoteStore>
  gitMirrorStore: (spaceId: string, remoteUrl: string, branch: string, auth?: GitAuth) => RemoteStore
}

export type GitRemoteInput = Partial<GitBackendConfig> & { remoteUrl: string; token?: string; spaceId?: string }

const WRITE_DEBOUNCE_MS = 2000
const EXTERNAL_DEBOUNCE_MS = 30000

export class KbSyncService {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private debouncers = new Map<string, ReturnType<typeof setTimeout>>()
  private running = new Map<string, Promise<KbSyncReport>>()
  private again = new Set<string>()
  private encryption: EncryptionHooks | null = null

  constructor(private readonly kb: KbService) {}

  setEncryption(hooks: EncryptionHooks): void {
    this.encryption = hooks
  }

  machineName(): string {
    return readSyncConfig().machineName
  }

  start(): void {
    this.reschedule()
  }

  dispose(): void {
    for (const t of this.timers.values()) clearInterval(t)
    for (const t of this.debouncers.values()) clearTimeout(t)
    this.timers.clear()
    this.debouncers.clear()
  }

  reschedule(): void {
    for (const t of this.timers.values()) clearInterval(t)
    this.timers.clear()
    for (const space of this.kb.listSpaces()) {
      if (space.backend === 'none' || space.sync.intervalMin <= 0) continue
      const ms = Math.max(1, space.sync.intervalMin) * 60_000
      this.timers.set(
        space.id,
        setInterval(() => void this.syncNow(space.id).catch((e) => log.warn('Scheduled knowledge sync failed:', e)), ms)
      )
    }
  }

  private debounce(key: string, ms: number, fn: () => void): void {
    const existing = this.debouncers.get(key)
    if (existing) clearTimeout(existing)
    this.debouncers.set(
      key,
      setTimeout(() => {
        this.debouncers.delete(key)
        fn()
      }, ms)
    )
  }

  onLocalWrite(spaceId: string, _paths: string[], _origin: KbOrigin): void {
    const space = this.safeSpace(spaceId)
    if (!space || space.backend === 'none' || !space.sync.onWrite) return
    this.debounce(`write:${spaceId}`, WRITE_DEBOUNCE_MS, () => void this.syncNow(spaceId).catch(() => {}))
  }

  onExternalChange(spaceId: string): void {
    const space = this.safeSpace(spaceId)
    if (!space || space.backend === 'none') return
    if (space.sync.onWrite) {
      this.debounce(`external:${spaceId}`, EXTERNAL_DEBOUNCE_MS, () => void this.syncNow(spaceId).catch(() => {}))
    } else if (space.sync.autoCommitExternal && space.backend === 'git' && !space.encrypted) {
      this.debounce(`external:${spaceId}`, EXTERNAL_DEBOUNCE_MS, () => void this.commitOnly(spaceId).catch(() => {}))
    }
  }

  private safeSpace(id: string): KbSpace | null {
    try {
      return this.kb.getSpace(id)
    } catch {
      return null
    }
  }

  private async commitOnly(spaceId: string): Promise<void> {
    const space = this.kb.getSpace(spaceId)
    const root = space.localPath
    if (!(await isRepoRoot(root))) return
    await commitAll(root, `Update notes (${this.machineName()})`)
  }

  private loadState(spaceId: string): SyncState {
    const rows = getDb().prepare('SELECT * FROM kb_sync_state WHERE space_id = ?').all(spaceId) as Array<{
      path: string
      local_hash: string | null
      remote_hash: string | null
      remote_size: number | null
      remote_mtime: number | null
    }>
    return new Map(
      rows.map((r) => [
        r.path,
        { localHash: r.local_hash, remoteHash: r.remote_hash, remoteSize: r.remote_size, remoteMtime: r.remote_mtime }
      ])
    )
  }

  private saveState(spaceId: string, state: SyncState): void {
    const db = getDb()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM kb_sync_state WHERE space_id = ?').run(spaceId)
      const insert = db.prepare(
        'INSERT INTO kb_sync_state (space_id, path, local_hash, remote_hash, remote_size, remote_mtime) VALUES (?, ?, ?, ?, ?, ?)'
      )
      for (const [path, e] of state) insert.run(spaceId, path, e.localHash, e.remoteHash, e.remoteSize, e.remoteMtime)
    })
    tx()
  }

  resetState(spaceId: string): void {
    getDb().prepare('DELETE FROM kb_sync_state WHERE space_id = ?').run(spaceId)
  }

  private gate(spaceId: string): () => { ok: true } | { ok: false; reason: 'review' | 'locked' | 'readonly'; message: string } {
    return () => {
      if (this.kb.getSpace(spaceId).encrypted && this.encryption && !this.encryption.canPublish(spaceId)) {
        return { ok: false, reason: 'readonly', message: 'You have read-only access to this space: local changes are not uploaded.' }
      }
      const pending = this.kb.pendingReview(spaceId).length
      if (pending > 0) {
        return {
          ok: false,
          reason: 'review',
          message: `${pending} change(s) written by assistants wait for review before they leave this computer.`
        }
      }
      return { ok: true }
    }
  }

  async syncNow(spaceId: string): Promise<KbSyncReport> {
    const inFlight = this.running.get(spaceId)
    if (inFlight) {
      this.again.add(spaceId)
      return inFlight
    }
    const job = this.runSync(spaceId)
      .catch((error: unknown) => {
        const report = emptyReport()
        report.ok = false
        report.blockedBy = error instanceof RemoteLockedError ? 'locked' : null
        report.message = (error as Error).message || String(error)
        return report
      })
      .then((report) => {
        try {
          this.kb.recordSync(spaceId, report)
        } catch {
          return report
        }
        pushEvent('kb:sync-report', { spaceId, report })
        if (report.pulled.length > 0 || report.deletedLocal.length > 0) {
          this.kb.emitChanged(spaceId, [...report.pulled, ...report.deletedLocal])
        }
        return report
      })
      .finally(() => {
        this.running.delete(spaceId)
        if (this.again.delete(spaceId)) void this.syncNow(spaceId)
      })
    this.running.set(spaceId, job)
    return job
  }

  private async runSync(spaceId: string): Promise<KbSyncReport> {
    const space = this.kb.getSpace(spaceId)
    if (!space.exists) throw new Error(`The space folder is missing: ${space.localPath}`)
    const root = this.kb.rootPathOf(spaceId)
    const childDirs = this.kb.familyOf(spaceId).childDirsOf(spaceId)
    const blockSecrets = space.shared
    const machineName = this.machineName()
    if (space.backend === 'none') throw new Error('This space has no remote. Choose git, a folder or SFTP in its settings.')

    if (space.encrypted) {
      if (!this.encryption) throw new Error('Encryption is not available')
      if (!(await this.encryption.ensureUnlocked(spaceId))) {
        const report = emptyReport()
        report.ok = false
        report.blockedBy = 'locked'
        report.message = 'The space is locked. Unlock it with its passphrase to sync.'
        return report
      }
      const raw = await this.rawStoreFor(spaceId)
      const store = await this.encryption.wrapStore(spaceId, raw)
      return this.runThreeWay(spaceId, root, store, { machineName, childDirs, blockSecrets })
    }

    if (space.backend === 'git') {
      const remoteUrl = space.backendConfig.remoteUrl ?? ''
      if (!remoteUrl) throw new Error('Set the git remote of the space first')
      if (isCloudSyncedPath(root)) throw new Error('Git cannot run inside a cloud-synced folder. Move the space first.')
      const branch = space.backendConfig.branch || 'main'
      const auth = await this.gitAuthFor(space.backendConfig, spaceId)
      const { authorName, authorEmail } = space.backendConfig
      await ensureRepo(root, remoteUrl, branch, childDirs, { name: authorName, email: authorEmail })
      return syncGitSpace(root, { branch, machineName, childDirs, blockSecrets, auth, allowPush: this.gate(spaceId) })
    }
    return this.runThreeWay(spaceId, root, await this.rawStore(space, false), { machineName, childDirs, blockSecrets })
  }

  private async runThreeWay(
    spaceId: string,
    root: string,
    store: RemoteStore,
    options: { machineName: string; childDirs: string[]; blockSecrets: boolean }
  ): Promise<KbSyncReport> {
    const { report, state } = await syncThreeWay(root, store, this.loadState(spaceId), {
      ...options,
      allowPush: this.gate(spaceId)
    })
    this.saveState(spaceId, state)
    return report
  }

  async gitAuthFor(config: KbBackendConfig, spaceId?: string, typed?: GitCredential): Promise<GitAuth | undefined> {
    const mode = config.gitAuth ?? 'system'
    const url = config.remoteUrl ?? ''
    if (mode === 'system') return undefined
    if (mode === 'ssh-key') return sshKeyAuth(config.sshKeyPath ?? '')
    const info = parseRemote(url)
    if (mode === 'gh') {
      const username = config.gitUsername || undefined
      return tokenAuth(info, { username: username ?? 'x-access-token', token: await ghToken(info.host ?? '', username) })
    }
    const credential = typed ?? (spaceId ? getGitCredential(spaceId, url) : null)
    if (!credential) throw new Error('This space needs a token for its repository. Write it in the space settings, in the app window.')
    return tokenAuth(info, credential)
  }

  storeGitToken(spaceId: string, token: string): void {
    const { backendConfig } = this.kb.getSpace(spaceId)
    const url = backendConfig.remoteUrl ?? ''
    setGitCredential(spaceId, url, { username: this.usernameOf(backendConfig), token: token.trim() })
  }

  private usernameOf(config: KbBackendConfig): string {
    return config.gitUsername?.trim() || defaultUsername(detectProvider(parseRemote(config.remoteUrl ?? '').host))
  }

  async testRemote(input: GitRemoteInput): Promise<RemoteProbe> {
    parseRemote(input.remoteUrl)
    const typed = input.token ? { username: this.usernameOf(input), token: input.token.trim() } : undefined
    return probeRemote(input.remoteUrl, await this.gitAuthFor(input, input.spaceId, typed))
  }

  rawStoreFor(spaceId: string): Promise<RemoteStore> {
    return this.rawStore(this.kb.getSpace(spaceId), true)
  }

  private async rawStore(space: KbSpace, forEncryption: boolean): Promise<RemoteStore> {
    const holder = `${this.machineName()}#${space.id.slice(0, 8)}`
    if (space.backend === 'folder') {
      const path = space.backendConfig.path
      if (!path) throw new Error('Choose the destination folder of the space first')
      return new FsStore(path, holder)
    }
    if (space.backend === 'sftp') {
      const config = space.backendConfig as SftpBackendConfig
      if (!config.host || !config.username || !config.remotePath) throw new Error('Complete the SFTP settings of the space first')
      const passphrase = getSecret(`sftp:${space.id}`)?.toString('utf-8')
      return new SftpStore(config, holder, passphrase)
    }
    if (space.backend === 'git' && forEncryption) {
      if (!this.encryption) throw new Error('Encryption is not available')
      const auth = await this.gitAuthFor(space.backendConfig, space.id)
      return this.encryption.gitMirrorStore(space.id, space.backendConfig.remoteUrl ?? '', space.backendConfig.branch || 'main', auth)
    }
    throw new Error(`Unsupported backend: ${space.backend}`)
  }

  async testBackend(spaceId: string): Promise<Record<string, unknown>> {
    const space = this.kb.getSpace(spaceId)
    if (space.backend === 'git') {
      const url = space.backendConfig.remoteUrl
      if (!url) throw new Error('Set the git remote first')
      return { ...(await this.testRemote({ ...space.backendConfig, remoteUrl: url, spaceId })) }
    }
    if (space.backend === 'folder') {
      const path = space.backendConfig.path
      return { ok: Boolean(path && existsSync(path)), cloudSynced: path ? isCloudSyncedPath(path) : false }
    }
    if (space.backend === 'sftp') {
      const passphrase = getSecret(`sftp:${space.id}`)?.toString('utf-8')
      const probe = await probeSftp(space.backendConfig as SftpBackendConfig, passphrase)
      return { ok: true, ...probe }
    }
    return { ok: false }
  }

  async history(spaceId: string, path: string): Promise<Array<{ hash: string; date: string; author: string; subject: string }>> {
    const root = this.kb.rootPathOf(spaceId)
    if (!(await isRepoRoot(root))) return []
    return noteHistory(root, path)
  }

  async noteAt(spaceId: string, path: string, commit: string): Promise<string> {
    return noteAt(this.kb.rootPathOf(spaceId), commit, path)
  }

  async noteDiff(spaceId: string, path: string, commit: string): Promise<string> {
    return noteDiff(this.kb.rootPathOf(spaceId), commit, path)
  }

  async cloneAndAdd(input: GitRemoteInput & { targetPath: string; name?: string }): Promise<KbSpace> {
    if (isCloudSyncedPath(input.targetPath)) throw new Error('Clone into a local folder, not a cloud-synced one.')
    const { targetPath, name, token, spaceId: _ignored, ...config } = input
    const branch = config.branch || 'main'
    const typed = token ? { username: this.usernameOf(config), token: token.trim() } : undefined
    const identity = { name: config.authorName, email: config.authorEmail }
    await cloneSpace(config.remoteUrl, targetPath, branch, await this.gitAuthFor(config, undefined, typed), identity)
    const space = await this.kb.addSpace({
      localPath: targetPath,
      name,
      backend: 'git',
      backendConfig: { ...config, branch },
      sync: { intervalMin: 15, onWrite: true, autoCommitExternal: true }
    })
    if (typed) setGitCredential(space.id, config.remoteUrl, typed)
    return this.kb.getSpace(space.id)
  }
}
