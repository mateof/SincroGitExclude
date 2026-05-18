import { v4 as uuidv4 } from 'uuid'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { getDb } from '../database/connection'
import { GitService } from '../git/git-service'
import { GitExcludeService } from '../git/git-exclude'
import type { TagRow } from './file-service'
import log from 'electron-log'

export interface RepoRow {
  id: string
  path: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface EnrichedRepo extends RepoRow {
  displayName: string
  deploymentCount: number
  filesCount: number
  lastActivity: string | null
  pathExists: boolean
  isValidGit: boolean
  tags: TagRow[]
  // Lazy fields (only set by getRepo)
  currentBranch?: string | null
  remoteUrl?: string | null
  hasUncommittedChangesExternal?: boolean
  excludeEntriesCount?: number
  hasManualExcludes?: boolean
}

export interface RepoDeploymentRow {
  id: string
  fileId: string
  fileName: string
  fileAlias: string
  fileType: 'file' | 'bundle'
  fileRelativePath: string
  branchName: string
  isActive: number
  lastSyncedAt: string | null
  description: string | null
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

export class RepoService {
  constructor(
    private gitService: GitService,
    private excludeService: GitExcludeService
  ) {}

  private rowToEnriched(
    row: RepoRow & { deployment_count: number; files_count: number; last_activity: string | null }
  ): EnrichedRepo {
    const tags = this.getRepoTags(row.id)
    return {
      id: row.id,
      path: row.path,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      displayName: basename(row.path) || row.path,
      deploymentCount: row.deployment_count,
      filesCount: row.files_count,
      lastActivity: row.last_activity,
      pathExists: existsSync(row.path),
      isValidGit: this.excludeService.isGitRepo(row.path),
      tags
    }
  }

  listRepos(): EnrichedRepo[] {
    const rows = getDb()
      .prepare(
        `SELECT r.*,
                COUNT(d.id) AS deployment_count,
                COUNT(DISTINCT d.file_id) AS files_count,
                MAX(d.last_synced_at) AS last_activity
         FROM repos r
         LEFT JOIN deployments d ON d.repo_path = r.path AND d.is_active = 1
         GROUP BY r.id
         ORDER BY r.updated_at DESC`
      )
      .all() as Array<
      RepoRow & { deployment_count: number; files_count: number; last_activity: string | null }
    >

    return rows.map((r) => this.rowToEnriched(r))
  }

  async getRepo(id: string): Promise<EnrichedRepo | null> {
    const row = getDb()
      .prepare(
        `SELECT r.*,
                COUNT(d.id) AS deployment_count,
                COUNT(DISTINCT d.file_id) AS files_count,
                MAX(d.last_synced_at) AS last_activity
         FROM repos r
         LEFT JOIN deployments d ON d.repo_path = r.path AND d.is_active = 1
         WHERE r.id = ?
         GROUP BY r.id`
      )
      .get(id) as
      | (RepoRow & { deployment_count: number; files_count: number; last_activity: string | null })
      | undefined
    if (!row) return null

    const enriched = this.rowToEnriched(row)

    // Compute lazy fields only if repo is valid on disk
    if (enriched.pathExists && enriched.isValidGit) {
      try {
        enriched.currentBranch = await this.gitService.getCurrentBranch(enriched.path)
      } catch {
        enriched.currentBranch = null
      }
      try {
        enriched.remoteUrl = await this.gitService.getRemoteUrl(enriched.path)
      } catch {
        enriched.remoteUrl = null
      }
      try {
        enriched.hasUncommittedChangesExternal =
          await this.gitService.hasUncommittedChangesExternal(enriched.path)
      } catch {
        enriched.hasUncommittedChangesExternal = false
      }
      try {
        const entries = this.excludeService.listEntries(enriched.path)
        enriched.excludeEntriesCount = entries.length
        enriched.hasManualExcludes = entries.some(
          (e) => e.managedByApp && e.deploymentId === 'manual'
        )
      } catch {
        enriched.excludeEntriesCount = 0
        enriched.hasManualExcludes = false
      }
    }

    return enriched
  }

  addRepo(path: string, description?: string): RepoRow {
    const normalized = normalizePath(path)
    if (!existsSync(normalized)) {
      throw new Error('Path does not exist on disk')
    }
    if (!this.excludeService.isGitRepo(normalized)) {
      throw new Error('Path is not a git repository')
    }

    const existing = getDb()
      .prepare('SELECT id FROM repos WHERE path = ?')
      .get(normalized) as { id: string } | undefined
    if (existing) {
      throw new Error('This repo is already managed')
    }

    const id = uuidv4()
    getDb()
      .prepare('INSERT INTO repos (id, path, description) VALUES (?, ?, ?)')
      .run(id, normalized, description ?? null)

    log.info(`Added repo ${id} at ${normalized}`)
    return this.getRow(id)!
  }

  updateDescription(id: string, description: string | null): RepoRow {
    getDb()
      .prepare("UPDATE repos SET description = ?, updated_at = datetime('now') WHERE id = ?")
      .run(description, id)
    return this.getRow(id)!
  }

  removeRepo(id: string): void {
    const repo = this.getRow(id)
    if (!repo) throw new Error('Repo not found')

    const active = getDb()
      .prepare('SELECT COUNT(*) as c FROM deployments WHERE repo_path = ? AND is_active = 1')
      .get(repo.path) as { c: number }
    if (active.c > 0) {
      throw new Error(`Cannot remove: ${active.c} active deployment(s) use this repo`)
    }

    getDb().prepare('DELETE FROM repos WHERE id = ?').run(id)
    log.info(`Removed repo ${id} (${repo.path})`)
  }

  getRow(id: string): RepoRow | null {
    return (
      (getDb().prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow) || null
    )
  }

  getRowByPath(path: string): RepoRow | null {
    return (
      (getDb()
        .prepare('SELECT * FROM repos WHERE path = ?')
        .get(normalizePath(path)) as RepoRow) || null
    )
  }

  upsertByPath(path: string): void {
    const normalized = normalizePath(path)
    getDb()
      .prepare(
        `INSERT INTO repos (id, path) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')`
      )
      .run(uuidv4(), normalized)
  }

  // --- Tags ---

  getRepoTags(repoId: string): TagRow[] {
    return getDb()
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
         INNER JOIN repo_tags rt ON rt.tag_id = t.id
         WHERE rt.repo_id = ?`
      )
      .all(repoId) as TagRow[]
  }

  setRepoTags(repoId: string, tagIds: string[]): void {
    const db = getDb()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM repo_tags WHERE repo_id = ?').run(repoId)
      const insert = db.prepare('INSERT INTO repo_tags (repo_id, tag_id) VALUES (?, ?)')
      for (const tagId of tagIds) {
        insert.run(repoId, tagId)
      }
    })
    tx()
  }

  // --- Deployments in this repo ---

  listRepoDeployments(repoId: string): RepoDeploymentRow[] {
    const repo = this.getRow(repoId)
    if (!repo) return []

    const rows = getDb()
      .prepare(
        `SELECT d.id, d.file_id, d.file_relative_path, d.branch_name, d.is_active,
                d.last_synced_at, d.description,
                f.name AS file_name, f.alias AS file_alias, f.type AS file_type
         FROM deployments d
         INNER JOIN files f ON f.id = d.file_id
         WHERE d.repo_path = ?
         ORDER BY f.name, d.created_at DESC`
      )
      .all(repo.path) as Array<{
      id: string
      file_id: string
      file_relative_path: string
      branch_name: string
      is_active: number
      last_synced_at: string | null
      description: string | null
      file_name: string
      file_alias: string
      file_type: 'file' | 'bundle'
    }>

    return rows.map((r) => ({
      id: r.id,
      fileId: r.file_id,
      fileName: r.file_name,
      fileAlias: r.file_alias,
      fileType: r.file_type,
      fileRelativePath: r.file_relative_path,
      branchName: r.branch_name,
      isActive: r.is_active,
      lastSyncedAt: r.last_synced_at,
      description: r.description
    }))
  }
}
