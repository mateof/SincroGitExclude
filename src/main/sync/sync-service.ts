import { existsSync, rmSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { DEFAULT_DATA_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import type { GitService, CommitLogEntry } from '../git/git-service'
import { internalRepoPath } from '../services/deployment-context'
import { changeStatus } from '../services/change-status'
import {
  cloneFile,
  fetchFile,
  fetchMeta,
  integrateFile,
  lsRemote,
  mergeMeta,
  MetaConflictError,
  pushFile,
  pushMeta,
  readLocalMeta,
  remoteBranchesOf,
  remoteFilePrefix,
  remoteTagsOf,
  REMOTE_BRANCH_PREFIX,
  serializeMeta,
  type BranchReport,
  type MetaFile,
  type MetaMachine
} from './sync-engine'
import { readSyncConfig, SYNC_META_REPO, validateRemoteUrl, writeSyncConfig, type SyncConfig } from './sync-config'

export interface SyncIssue {
  fileId: string
  fileName: string
  detail: string
}

export interface SyncReport {
  direction: 'push' | 'pull'
  pushed: number
  upToDate: number
  created: number
  updated: number
  fastForwarded: number
  conflicts: SyncIssue[]
  errors: SyncIssue[]
  deletedRemotely: SyncIssue[]
  finishedAt: string
}

export interface RemoteSource {
  ref: string
  branch: string
  machineId: string
  machineName: string
  repoPath: string
  relativePath: string
  description: string | null
}

interface FileRow {
  id: string
  name: string
  alias: string
  type: string
  use_auto_icon: number
  ignore_patterns: string | null
  created_at: string
  updated_at: string
  meta_updated_at: string | null
}

function newReport(direction: 'push' | 'pull'): SyncReport {
  return {
    direction,
    pushed: 0,
    upToDate: 0,
    created: 0,
    updated: 0,
    fastForwarded: 0,
    conflicts: [],
    errors: [],
    deletedRemotely: [],
    finishedAt: ''
  }
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export class SyncService {
  private running = false

  constructor(
    private gitService: GitService,
    private onFileMetadataChanged: (fileId: string) => Promise<void> = async () => {}
  ) {}

  getConfig(): SyncConfig {
    return readSyncConfig()
  }

  setConfig(patch: { remoteUrl?: string; machineName?: string }): SyncConfig {
    const update: Partial<SyncConfig> = {}
    if (patch.remoteUrl !== undefined) {
      const error = validateRemoteUrl(patch.remoteUrl)
      if (error) throw new Error(error)
      update.remoteUrl = patch.remoteUrl.trim()
    }
    if (patch.machineName !== undefined) {
      const name = patch.machineName.trim()
      if (!name) throw new Error('The machine name cannot be empty')
      update.machineName = name
    }
    return writeSyncConfig(update)
  }

  async testConnection(url?: string): Promise<{ refs: number; files: number }> {
    const target = this.requireUrl(url)
    const refs = await lsRemote(target, DEFAULT_DATA_DIR)
    const files = new Set(
      [...refs.keys()]
        .filter((ref) => ref.startsWith('refs/heads/sge/files/'))
        .map((ref) => ref.split('/')[4])
    )
    return { refs: refs.size, files: files.size }
  }

  async push(): Promise<SyncReport> {
    return this.exclusive(async () => {
      const url = this.requireUrl()
      const report = newReport('push')
      let remoteRefs = await lsRemote(url, DEFAULT_DATA_DIR)

      for (const file of this.listFileRows()) {
        const repo = internalRepoPath(file.id)
        if (!existsSync(repo)) continue
        try {
          const result = await this.gitService.withLock(repo, () =>
            pushFile(repo, url, file.id, remoteRefs)
          )
          if (result.status === 'up-to-date') report.upToDate++
          else report.pushed++
          for (const rejected of result.rejected) {
            report.conflicts.push({
              fileId: file.id,
              fileName: file.alias || file.name,
              detail: `${rejected.ref.replace('refs/heads/', '').replace('refs/tags/', 'tag ')}: ${rejected.reason}`
            })
          }
        } catch (error) {
          report.errors.push({ fileId: file.id, fileName: file.alias || file.name, detail: (error as Error).message })
        }
      }

      const config = readSyncConfig()
      for (let attempt = 0; attempt < 3; attempt++) {
        const { meta, parent } = await fetchMeta(SYNC_META_REPO, url, remoteRefs)
        const merged = mergeMeta(meta, {
          files: this.localMetaFiles(),
          tombstones: this.localTombstones(),
          machineId: config.machineId,
          machine: this.localMachine(config.machineName)
        })
        if (meta && serializeMeta(meta) === serializeMeta(merged)) break
        try {
          await pushMeta(SYNC_META_REPO, url, merged, parent, `Sync from ${config.machineName}`)
          break
        } catch (error) {
          if (!(error instanceof MetaConflictError) || attempt === 2) throw error
          remoteRefs = await lsRemote(url, DEFAULT_DATA_DIR)
        }
      }

      report.finishedAt = new Date().toISOString()
      writeSyncConfig({ lastPushAt: report.finishedAt })
      log.info(
        `Sync push: ${report.pushed} pushed, ${report.upToDate} up to date, ` +
          `${report.conflicts.length} conflicts, ${report.errors.length} errors`
      )
      return report
    })
  }

  async pull(): Promise<SyncReport> {
    return this.exclusive(async () => {
      const url = this.requireUrl()
      const report = newReport('pull')
      const remoteRefs = await lsRemote(url, DEFAULT_DATA_DIR)
      const { meta } = await fetchMeta(SYNC_META_REPO, url, remoteRefs)

      if (meta) {
        const tombstones = this.localTombstones()
        const local = new Map(this.listFileRows().map((f) => [f.id, f]))

        for (const remoteFile of Object.values(meta.files)) {
          if (tombstones[remoteFile.id]) continue
          const hasHistory = [...remoteRefs.keys()].some((ref) =>
            ref.startsWith(remoteFilePrefix(remoteFile.id))
          )
          const name = remoteFile.alias || remoteFile.name
          try {
            const existing = local.get(remoteFile.id)
            if (!existing) {
              if (!hasHistory) throw new Error('The remote has metadata but no history for this file')
              const repo = internalRepoPath(remoteFile.id)
              if (existsSync(repo)) throw new Error(`An unregistered internal folder already exists: ${repo}`)
              try {
                await cloneFile(repo, url, remoteFile.id)
                this.insertFile(remoteFile)
              } catch (error) {
                rmSync(repo, { recursive: true, force: true })
                throw error
              }
              report.created++
              continue
            }

            if (hasHistory) {
              const repo = internalRepoPath(remoteFile.id)
              const branchReports = await this.gitService.withLock(repo, async () => {
                await fetchFile(repo, url, remoteFile.id)
                return integrateFile(repo, this.localDeploymentBranches(remoteFile.id))
              })
              this.collectBranchReports(report, remoteFile.id, name, branchReports)
            }

            if (remoteFile.updatedAt > (existing.meta_updated_at ?? existing.updated_at)) {
              this.updateFileFromRemote(remoteFile)
              if ((existing.ignore_patterns ?? '') !== remoteFile.ignorePatterns) {
                await this.onFileMetadataChanged(remoteFile.id)
              }
              report.updated++
            }
          } catch (error) {
            report.errors.push({ fileId: remoteFile.id, fileName: name, detail: (error as Error).message })
          }
        }

        for (const [id, file] of local) {
          if (!meta.files[id] && meta.tombstones[id]) {
            report.deletedRemotely.push({
              fileId: id,
              fileName: file.alias || file.name,
              detail: meta.tombstones[id]
            })
          }
        }
      }

      changeStatus.invalidateAll()
      report.finishedAt = new Date().toISOString()
      writeSyncConfig({ lastPullAt: report.finishedAt })
      log.info(
        `Sync pull: ${report.created} created, ${report.updated} updated, ` +
          `${report.fastForwarded} fast-forwarded, ${report.conflicts.length} conflicts, ${report.errors.length} errors`
      )
      return report
    })
  }

  async remoteSources(fileId: string): Promise<RemoteSource[]> {
    const meta = await readLocalMeta(SYNC_META_REPO)
    const repo = internalRepoPath(fileId)
    if (!meta || !existsSync(repo)) return []

    const branches = await remoteBranchesOf(repo)
    const ownMachine = readSyncConfig().machineId
    const sources: RemoteSource[] = []
    for (const [machineId, machine] of Object.entries(meta.machines)) {
      if (machineId === ownMachine) continue
      for (const d of machine.deployments) {
        if (d.fileId !== fileId || !branches.has(d.branch)) continue
        sources.push({
          ref: `${REMOTE_BRANCH_PREFIX}${d.branch}`,
          branch: d.branch,
          machineId,
          machineName: machine.name,
          repoPath: d.repoPath,
          relativePath: d.relativePath,
          description: d.description
        })
      }
    }
    return sources
  }

  async remoteCommits(fileId: string, ref: string): Promise<CommitLogEntry[]> {
    if (!ref.startsWith(REMOTE_BRANCH_PREFIX)) throw new Error('Not a remote branch')
    const repo = internalRepoPath(fileId)
    const [commits, tags] = await Promise.all([
      this.gitService.getLog(repo, ref),
      remoteTagsOf(repo)
    ])
    return commits.map((c) => ({ ...c, tag: c.tag ?? tags.get(c.hash) }))
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error('A sync is already running')
    this.running = true
    try {
      return await fn()
    } finally {
      this.running = false
    }
  }

  private requireUrl(url?: string): string {
    const target = (url ?? readSyncConfig().remoteUrl).trim()
    if (!target) throw new Error('Configure the remote repository URL first')
    const error = validateRemoteUrl(target)
    if (error) throw new Error(error)
    return target
  }

  private listFileRows(): FileRow[] {
    return getDb().prepare('SELECT * FROM files').all() as FileRow[]
  }

  private tagsOf(fileId: string): Array<{ name: string; color: string }> {
    return getDb()
      .prepare(
        `SELECT t.name, t.color FROM tags t
         INNER JOIN file_tags ft ON ft.tag_id = t.id
         WHERE ft.file_id = ? ORDER BY t.name`
      )
      .all(fileId) as Array<{ name: string; color: string }>
  }

  private localMetaFiles(): MetaFile[] {
    return this.listFileRows().map((f) => ({
      id: f.id,
      name: f.name,
      alias: f.alias,
      type: f.type,
      useAutoIcon: f.use_auto_icon !== 0,
      ignorePatterns: f.ignore_patterns ?? '',
      tags: this.tagsOf(f.id),
      createdAt: f.created_at,
      updatedAt: f.meta_updated_at ?? f.updated_at
    }))
  }

  private localTombstones(): Record<string, string> {
    const rows = getDb().prepare('SELECT file_id, deleted_at FROM sync_tombstones').all() as Array<{
      file_id: string
      deleted_at: string
    }>
    return Object.fromEntries(rows.map((r) => [r.file_id, r.deleted_at]))
  }

  private localMachine(name: string): MetaMachine {
    const rows = getDb()
      .prepare(
        'SELECT id, file_id, branch_name, repo_path, file_relative_path, description, is_active FROM deployments'
      )
      .all() as Array<{
      id: string
      file_id: string
      branch_name: string
      repo_path: string
      file_relative_path: string
      description: string | null
      is_active: number
    }>
    return {
      name,
      updatedAt: nowSql(),
      deployments: rows.map((d) => ({
        id: d.id,
        fileId: d.file_id,
        branch: d.branch_name,
        repoPath: d.repo_path.replace(/\\/g, '/'),
        relativePath: d.file_relative_path.replace(/\\/g, '/'),
        description: d.description,
        isActive: d.is_active === 1
      }))
    }
  }

  private localDeploymentBranches(fileId: string): Set<string> {
    const rows = getDb()
      .prepare('SELECT branch_name FROM deployments WHERE file_id = ?')
      .all(fileId) as Array<{ branch_name: string }>
    return new Set(rows.map((r) => r.branch_name))
  }

  private collectBranchReports(
    report: SyncReport,
    fileId: string,
    fileName: string,
    branchReports: BranchReport[]
  ): void {
    for (const b of branchReports) {
      if (b.state === 'fast-forwarded') report.fastForwarded++
      else if (b.state === 'diverged') {
        report.conflicts.push({ fileId, fileName, detail: `${b.branch}: diverged from the remote` })
      } else if (b.state === 'behind') {
        report.conflicts.push({
          fileId,
          fileName,
          detail: `${b.branch}: the remote is ahead of this deployment`
        })
      }
    }
  }

  private setTagsByName(fileId: string, tags: Array<{ name: string; color: string }>): void {
    const db = getDb()
    db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(fileId)
    const find = db.prepare('SELECT id FROM tags WHERE name = ?')
    const create = db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
    const link = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)')
    for (const tag of tags) {
      let row = find.get(tag.name) as { id: string } | undefined
      if (!row) {
        row = { id: uuidv4() }
        create.run(row.id, tag.name, tag.color)
      }
      link.run(fileId, row.id)
    }
  }

  private insertFile(file: MetaFile): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare(
        `INSERT INTO files (id, name, alias, type, use_auto_icon, ignore_patterns, created_at, updated_at, meta_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
      ).run(
        file.id,
        file.name,
        file.alias,
        file.type,
        file.useAutoIcon ? 1 : 0,
        file.ignorePatterns,
        file.createdAt,
        file.updatedAt
      )
      this.setTagsByName(file.id, file.tags)
    })()
  }

  private updateFileFromRemote(file: MetaFile): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare(
        `UPDATE files SET name = ?, alias = ?, use_auto_icon = ?, ignore_patterns = ?, meta_updated_at = ?
         WHERE id = ?`
      ).run(file.name, file.alias, file.useAutoIcon ? 1 : 0, file.ignorePatterns, file.updatedAt, file.id)
      this.setTagsByName(file.id, file.tags)
    })()
  }
}
