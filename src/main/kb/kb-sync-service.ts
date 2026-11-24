import log from 'electron-log'
import { existsSync } from 'fs'
import { getDb } from '../database/connection'
import { pushEvent } from '../events'
import { readSyncConfig } from '../sync/sync-config'
import { execGit } from '../git/git-exec'
import type { KbService } from './kb-service'
import { emptyReport, ensureRepo, isRepoRoot, noteAt, noteDiff, noteHistory, syncGitSpace, commitAll, cloneSpace } from './sync/git-space'
import { syncThreeWay, type SyncState } from './sync/three-way'
import { FsStore } from './sync/fs-store'
import { SftpStore, probeSftp } from './sync/sftp-store'
import { RemoteLockedError, type RemoteStore } from './sync/remote-store'
import { getSecret } from './secret-vault'
import { isCloudSyncedPath } from '../utils/errors'
import type { KbOrigin, KbSpace, KbSyncReport, SftpBackendConfig } from '../../shared/kb/types'

export interface EncryptionHooks {
  ensureUnlocked: (spaceId: string) => Promise<boolean>
  canPublish: (spaceId: string) => boolean
  wrapStore: (spaceId: string, raw: RemoteStore) => Promise<RemoteStore>
  gitMirrorStore: (spaceId: string, remoteUrl: string, branch: string) => RemoteStore
}

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
      const raw = this.rawStoreFor(spaceId)
      const store = await this.encryption.wrapStore(spaceId, raw)
      return this.runThreeWay(spaceId, root, store, { machineName, childDirs, blockSecrets })
    }

    if (space.backend === 'git') {
      const remoteUrl = space.backendConfig.remoteUrl ?? ''
      if (!remoteUrl) throw new Error('Set the git remote of the space first')
      if (isCloudSyncedPath(root)) throw new Error('Git cannot run inside a cloud-synced folder. Move the space first.')
      const branch = space.backendConfig.branch || 'main'
      await ensureRepo(root, remoteUrl, branch, childDirs)
      return syncGitSpace(root, { branch, machineName, childDirs, blockSecrets, allowPush: this.gate(spaceId) })
    }
    return this.runThreeWay(spaceId, root, this.rawStore(space, false), { machineName, childDirs, blockSecrets })
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

  rawStoreFor(spaceId: string): RemoteStore {
    return this.rawStore(this.kb.getSpace(spaceId), true)
  }

  private rawStore(space: KbSpace, forEncryption: boolean): RemoteStore {
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
      return this.encryption.gitMirrorStore(space.id, space.backendConfig.remoteUrl ?? '', space.backendConfig.branch || 'main')
    }
    throw new Error(`Unsupported backend: ${space.backend}`)
  }

  async testBackend(spaceId: string): Promise<Record<string, unknown>> {
    const space = this.kb.getSpace(spaceId)
    if (space.backend === 'git') {
      const url = space.backendConfig.remoteUrl
      if (!url) throw new Error('Set the git remote first')
      const result = await execGit(['ls-remote', '--heads', url], { cwd: this.kb.rootPathOf(spaceId) })
      const branches = result.stdout
        .toString('utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t')[1]?.replace('refs/heads/', ''))
      return { ok: true, branches }
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

  async cloneAndAdd(input: { remoteUrl: string; branch?: string; targetPath: string; name?: string }): Promise<KbSpace> {
    if (isCloudSyncedPath(input.targetPath)) throw new Error('Clone into a local folder, not a cloud-synced one.')
    const branch = input.branch || 'main'
    await cloneSpace(input.remoteUrl, input.targetPath, branch)
    return this.kb.addSpace({
      localPath: input.targetPath,
      name: input.name,
      backend: 'git',
      backendConfig: { remoteUrl: input.remoteUrl, branch },
      sync: { intervalMin: 15, onWrite: true, autoCommitExternal: true }
    })
  }
}
