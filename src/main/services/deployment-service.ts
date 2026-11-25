import { v4 as uuidv4 } from 'uuid'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, unlinkSync, rmSync } from 'fs'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { GitService } from '../git/git-service'
import { GitExcludeService } from '../git/git-exclude'
import { WatcherService } from './watcher-service'
import { matchesAnyPattern } from '../utils/file-scanner'
import {
  commitChanges,
  hasChanges as treeHasChanges,
  listTrackedFiles,
  removeDeployedIndex,
  restoreFromCommit
} from '../git/deployed-tree'
import { treeOf } from './deployment-context'
import { changeStatus, mapWithConcurrency } from './change-status'
import type { TagRow } from './file-service'
import log from 'electron-log'

export interface DeploymentRow {
  id: string
  file_id: string
  repo_path: string
  file_relative_path: string
  branch_name: string
  is_active: number
  last_synced_at: string | null
  created_at: string
  current_commit_hash: string | null
  description: string | null
  tags?: TagRow[]
}

export class DeploymentService {
  constructor(
    private gitService: GitService,
    private excludeService: GitExcludeService,
    private watcherService: WatcherService
  ) {}

  private getFileType(fileId: string): string {
    const row = getDb()
      .prepare('SELECT type FROM files WHERE id = ?')
      .get(fileId) as { type: string } | undefined
    return row?.type ?? 'file'
  }

  private getBundleExcludePath(fileRelativePath: string): string {
    const base = fileRelativePath.replace(/[\\/]+$/, '').replace(/\\/g, '/')
    return base + '/'
  }

  async createDeployment(
    fileId: string,
    repoPath: string,
    fileRelativePath: string,
    sourceBranch?: string,
    sourceCommit?: string,
    autoExclude: boolean = true
  ): Promise<DeploymentRow> {
    const id = uuidv4()
    const branchName = `deploy-${id.substring(0, 8)}`
    const internalRepoPath = join(FILES_DIR, fileId)
    const fileType = this.getFileType(fileId)
    const isBundle = fileType === 'bundle'
    const startPoint = sourceCommit || sourceBranch

    log.info(
      `createDeployment: file=${fileId} type=${fileType} repo=${repoPath} ` +
        `target=${fileRelativePath} branch=${branchName} ` +
        `source=${startPoint ?? 'current HEAD'} autoExclude=${autoExclude}`
    )

    // Validate destination before touching anything.
    // Each case gets its own message so the UI never has to guess the cause.
    if (!existsSync(repoPath)) {
      throw new Error(`Destination folder does not exist: ${repoPath}`)
    }
    if (!this.excludeService.isGitRepo(repoPath)) {
      throw new Error(`Not a git repository (no .git found): ${repoPath}`)
    }
    if (!existsSync(join(internalRepoPath, '.git'))) {
      throw new Error(
        `Internal repository for this managed file is missing: ${internalRepoPath}`
      )
    }

    // Branch to return to if the attempt fails midway
    let previousBranch: string | null = null

    try {
      await this.gitService.withLock(internalRepoPath, async () => {
        try {
          previousBranch = await this.gitService.getCurrentBranch(internalRepoPath)
        } catch {
          // Repo with no commits yet or detached HEAD — nothing to roll back to
        }

        try {
          if (isBundle) {
            await this.gitService.createBranchRef(internalRepoPath, branchName, startPoint)
          } else {
            await this.gitService.createBranch(internalRepoPath, branchName, startPoint)
          }
        } catch (error) {
          throw new Error(
            `Could not create internal branch ${branchName}` +
              `${startPoint ? ` from ${startPoint}` : ''}: ${(error as Error).message}`
          )
        }

        try {
          await this.populateDeployment(
            id,
            internalRepoPath,
            repoPath,
            fileRelativePath,
            fileId,
            branchName,
            isBundle
          )
        } catch (error) {
          await this.rollbackBranch(internalRepoPath, branchName, previousBranch)
          throw error
        }
      })

      // Upsert into repos table (so this repo appears in the Repos view)
      const normalizedRepoPath = repoPath.replace(/\\/g, '/').replace(/\/+$/, '')
      getDb()
        .prepare(
          `INSERT INTO repos (id, path) VALUES (?, ?)
           ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')`
        )
        .run(uuidv4(), normalizedRepoPath)

      // Insert into DB
      getDb()
        .prepare(
          `INSERT INTO deployments (id, file_id, repo_path, file_relative_path, branch_name, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`
        )
        .run(id, fileId, repoPath, fileRelativePath, branchName)
    } catch (error) {
      // Covers the DB inserts too: if SQLite fails here the branch already
      // exists but no deployment row does, so drop the branch as well
      await this.gitService.withLock(internalRepoPath, () =>
        this.rollbackBranch(internalRepoPath, branchName, previousBranch)
      )
      log.error(
        `createDeployment failed: file=${fileId} repo=${repoPath} target=${fileRelativePath}`,
        error
      )
      throw error
    }

    log.info(`createDeployment: created deployment ${id} on branch ${branchName}`)

    return this.finishDeployment(id, fileId, repoPath, fileRelativePath, isBundle, autoExclude)
  }

  /**
   * Best-effort removal of a deployment branch created by a failed attempt.
   * Never throws: it runs while another error is already propagating.
   */
  private async rollbackBranch(
    internalRepoPath: string,
    branchName: string,
    previousBranch: string | null
  ): Promise<void> {
    if (!previousBranch || previousBranch === branchName) return
    try {
      const branches = await this.gitService.listBranches(internalRepoPath)
      if (!branches.includes(branchName)) return
      await this.gitService.checkout(internalRepoPath, previousBranch)
      await this.gitService.deleteBranch(internalRepoPath, branchName)
      log.info(`Rolled back branch ${branchName} after a failed deployment`)
    } catch (error) {
      log.warn(`Could not roll back branch ${branchName}:`, error)
    }
  }

  /**
   * Copies content between the internal repo and the deployed location.
   * Must run inside the internal repo lock, on the already-created branch.
   */
  private async populateDeployment(
    deploymentId: string,
    internalRepoPath: string,
    repoPath: string,
    fileRelativePath: string,
    fileId: string,
    branchName: string,
    isBundle: boolean
  ): Promise<void> {
      if (isBundle) {
        const tree = treeOf({
          id: deploymentId,
          file_id: fileId,
          repo_path: repoPath,
          file_relative_path: fileRelativePath,
          branch_name: branchName
        })
        mkdirSync(tree.workTree, { recursive: true })

        const missing = (await listTrackedFiles(tree)).filter(
          (relPath) =>
            !matchesAnyPattern(relPath, tree.ignorePatterns) &&
            !existsSync(join(tree.workTree, relPath))
        )
        await restoreFromCommit(tree, `refs/heads/${branchName}`, missing)

        try {
          await commitChanges(tree, 'Import existing file content')
        } catch (error) {
          if ((error as Error).message !== 'No changes to commit') throw error
        }
      } else {
        // Single file: existing logic
        const deployedFullPath = join(repoPath, fileRelativePath)

        if (existsSync(deployedFullPath)) {
          const existingContent = readFileSync(deployedFullPath)
          writeFileSync(join(internalRepoPath, 'content'), existingContent)
          try {
            await this.gitService.addAndCommit(
              internalRepoPath,
              'content',
              'Import existing file content'
            )
          } catch {
            // No changes - file is same as source
          }
        } else {
          const contentPath = join(internalRepoPath, 'content')
          if (existsSync(contentPath)) {
            mkdirSync(dirname(deployedFullPath), { recursive: true })
            copyFileSync(contentPath, deployedFullPath)
          }
        }
      }
  }

  /**
   * Post-insert steps: exclude entry and watcher. Failures here are logged but
   * do not undo the deployment — it already exists and works without them.
   */
  private async finishDeployment(
    id: string,
    fileId: string,
    repoPath: string,
    fileRelativePath: string,
    isBundle: boolean,
    autoExclude: boolean
  ): Promise<DeploymentRow> {
    // Add to git exclude (if enabled)
    if (autoExclude) {
      try {
        const excludePath = isBundle
          ? this.getBundleExcludePath(fileRelativePath)
          : fileRelativePath
        await this.excludeService.addExclusion(repoPath, excludePath, id)
      } catch (error) {
        log.warn(`Deployment ${id} created but exclude entry failed:`, error)
      }
    }

    changeStatus.invalidate(id)

    // Start watching
    const watchPath = join(repoPath, fileRelativePath)
    try {
      await this.watcherService.watchDeployment(id, watchPath)
    } catch (error) {
      log.warn(`Deployment ${id} created but watcher failed to start:`, error)
    }

    log.info(`Created deployment ${id} for file ${fileId} at ${watchPath}`)
    return this.getDeployment(id)!
  }

  getDeployment(id: string): DeploymentRow | null {
    return (
      (getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(id) as DeploymentRow) || null
    )
  }

  getStats(): { activeDeployments: number; totalDeployments: number } {
    const row = getDb()
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
         FROM deployments`
      )
      .get() as { total: number; active: number }
    return {
      activeDeployments: row.active,
      totalDeployments: row.total
    }
  }

  async countPendingChanges(): Promise<{ count: number; fileIds: string[] }> {
    const activeDeployments = getDb()
      .prepare('SELECT id, file_id FROM deployments WHERE is_active = 1')
      .all() as Array<{ id: string; file_id: string }>

    const results = await mapWithConcurrency(activeDeployments, 4, async (d) => {
      const cached = changeStatus.get(d.id)
      if (cached !== undefined) return cached
      try {
        return await this.checkForChanges(d.id)
      } catch {
        return false
      }
    })

    const fileIds = new Set<string>()
    let count = 0
    results.forEach((changed, i) => {
      if (!changed) return
      count++
      fileIds.add(activeDeployments[i].file_id)
    })
    return { count, fileIds: [...fileIds] }
  }

  listDeployments(fileId: string): DeploymentRow[] {
    const deployments = getDb()
      .prepare('SELECT * FROM deployments WHERE file_id = ? ORDER BY created_at DESC')
      .all(fileId) as DeploymentRow[]

    const tagStmt = getDb().prepare(
      `SELECT t.id, t.name, t.color FROM tags t
       INNER JOIN deployment_tags dt ON dt.tag_id = t.id
       WHERE dt.deployment_id = ?`
    )
    for (const dep of deployments) {
      dep.tags = tagStmt.all(dep.id) as TagRow[]
    }

    return deployments
  }

  async deactivateDeployment(id: string): Promise<void> {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    getDb()
      .prepare('UPDATE deployments SET is_active = 0 WHERE id = ?')
      .run(id)

    changeStatus.invalidate(id)

    // Stop watching
    await this.watcherService.unwatchDeployment(id)

    // Remove from git exclude
    const fileType = this.getFileType(deployment.file_id)
    if (fileType === 'bundle') {
      const excludePath = this.getBundleExcludePath(deployment.file_relative_path)
      await this.excludeService.removeExclusion(deployment.repo_path, excludePath, id)
    } else {
      await this.excludeService.removeExclusion(
        deployment.repo_path,
        deployment.file_relative_path,
        id
      )
    }

    log.info(`Deactivated deployment ${id}`)
  }

  async reactivateDeployment(id: string): Promise<void> {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    const fullPath = join(deployment.repo_path, deployment.file_relative_path)

    getDb()
      .prepare('UPDATE deployments SET is_active = 1 WHERE id = ?')
      .run(id)
    changeStatus.invalidate(id)

    // Re-add to git exclude
    const fileType = this.getFileType(deployment.file_id)
    if (fileType === 'bundle') {
      const excludePath = this.getBundleExcludePath(deployment.file_relative_path)
      await this.excludeService.addExclusion(deployment.repo_path, excludePath, id)
    } else {
      await this.excludeService.addExclusion(
        deployment.repo_path,
        deployment.file_relative_path,
        id
      )
    }

    // Start watching if path exists
    if (existsSync(fullPath)) {
      await this.watcherService.watchDeployment(id, fullPath)
    }

    log.info(`Reactivated deployment ${id}`)
  }

  async deleteDeployment(id: string, deleteFromDisk: boolean = false): Promise<void> {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    // Stop watching
    await this.watcherService.unwatchDeployment(id)

    // Remove from git exclude
    try {
      const fileType = this.getFileType(deployment.file_id)
      if (fileType === 'bundle') {
        const excludePath = this.getBundleExcludePath(deployment.file_relative_path)
        await this.excludeService.removeExclusion(deployment.repo_path, excludePath, id)
      } else {
        await this.excludeService.removeExclusion(
          deployment.repo_path,
          deployment.file_relative_path,
          id
        )
      }
    } catch {
      // Repo might not exist anymore
    }

    // Optionally delete deployed files from disk
    if (deleteFromDisk) {
      try {
        const fileType = this.getFileType(deployment.file_id)
        if (fileType === 'bundle') {
          const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
          if (existsSync(deployBasePath)) {
            rmSync(deployBasePath, { recursive: true, force: true })
          }
        } else {
          const deployedPath = join(deployment.repo_path, deployment.file_relative_path)
          if (existsSync(deployedPath)) {
            unlinkSync(deployedPath)
          }
        }
      } catch (err) {
        log.warn(`Could not delete deployed files for ${id}:`, err)
      }
    }

    // Delete deployment branch from internal repo
    try {
      const internalRepoPath = join(FILES_DIR, deployment.file_id)
      if (existsSync(internalRepoPath)) {
        await this.gitService.withLock(internalRepoPath, async () => {
          // Switch away from the branch before deleting it
          const currentBranch = await this.gitService.getCurrentBranch(internalRepoPath)
          if (currentBranch === deployment.branch_name) {
            // Find another branch to switch to
            const branches = await this.gitService.listBranches(internalRepoPath)
            const other = branches.find((b) => b !== deployment.branch_name)
            if (other) {
              await this.gitService.checkout(internalRepoPath, other)
            }
          }
          await this.gitService.deleteBranch(internalRepoPath, deployment.branch_name)
          removeDeployedIndex(internalRepoPath, id)
        })
      }
    } catch (err) {
      log.warn(`Could not delete branch ${deployment.branch_name} for deployment ${id}:`, err)
    }

    // Delete from DB (cascade removes deployment_tags and snapshots)
    getDb().prepare('DELETE FROM deployments WHERE id = ?').run(id)
    changeStatus.invalidate(id)

    log.info(`Deleted deployment ${id}${deleteFromDisk ? ' (files removed from disk)' : ''}`)
  }

  async syncDeployment(id: string): Promise<void> {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
    if (!existsSync(deployedFullPath)) {
      throw new Error(
        this.getFileType(deployment.file_id) === 'bundle'
          ? 'Deployed directory does not exist'
          : 'Deployed file does not exist'
      )
    }

    await this.checkForChanges(id)

    getDb()
      .prepare("UPDATE deployments SET last_synced_at = datetime('now') WHERE id = ?")
      .run(id)
  }

  async checkForChanges(id: string): Promise<boolean> {
    const deployment = this.getDeployment(id)
    if (!deployment) return false

    const result = await this.computeChanges(deployment)
    changeStatus.set(id, result)
    return result
  }

  private async computeChanges(deployment: DeploymentRow): Promise<boolean> {
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const branchName = deployment.branch_name

    if (fileType === 'bundle') {
      const tree = treeOf(deployment)
      if (!existsSync(tree.workTree)) return false
      return this.gitService.withLock(internalRepoPath, () => treeHasChanges(tree))
    } else {
      const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
      if (!existsSync(deployedFullPath)) return false

      return this.gitService.withLock(internalRepoPath, async () => {
        await this.gitService.checkout(internalRepoPath, branchName)

        const contentPath = join(internalRepoPath, 'content')
        const original = readFileSync(contentPath)
        // Use read+write to avoid copying file mode (would show as mode-only diff)
        const deployedContent = readFileSync(deployedFullPath)
        writeFileSync(contentPath, deployedContent)

        const hasChanges = await this.gitService.hasChanges(internalRepoPath, false)

        // Restore
        writeFileSync(contentPath, original)
        return hasChanges
      })
    }
  }

  async restartWatchersForFile(fileId: string): Promise<void> {
    const deployments = getDb()
      .prepare('SELECT id, repo_path, file_relative_path FROM deployments WHERE file_id = ? AND is_active = 1')
      .all(fileId) as Array<{ id: string; repo_path: string; file_relative_path: string }>

    for (const d of deployments) {
      changeStatus.invalidate(d.id)
      const fullPath = join(d.repo_path, d.file_relative_path)
      await this.watcherService.unwatchDeployment(d.id)
      if (existsSync(fullPath)) await this.watcherService.watchDeployment(d.id, fullPath)
    }
  }

  async checkExcludeStatus(id: string): Promise<boolean> {
    const deployment = this.getDeployment(id)
    if (!deployment) return false

    const fileType = this.getFileType(deployment.file_id)
    if (fileType === 'bundle') {
      const excludePath = this.getBundleExcludePath(deployment.file_relative_path)
      return this.excludeService.isExcluded(deployment.repo_path, excludePath)
    }

    return this.excludeService.isExcluded(
      deployment.repo_path,
      deployment.file_relative_path
    )
  }

  checkFileExists(id: string): boolean {
    const deployment = this.getDeployment(id)
    if (!deployment) return false
    const fullPath = join(deployment.repo_path, deployment.file_relative_path)
    return existsSync(fullPath)
  }

  updateDescription(id: string, description: string | null): DeploymentRow {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    getDb()
      .prepare('UPDATE deployments SET description = ? WHERE id = ?')
      .run(description, id)

    return this.getDeployment(id)!
  }

  getDeploymentTags(deploymentId: string): TagRow[] {
    return getDb()
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
         INNER JOIN deployment_tags dt ON dt.tag_id = t.id
         WHERE dt.deployment_id = ?`
      )
      .all(deploymentId) as TagRow[]
  }

  setDeploymentTags(deploymentId: string, tagIds: string[]): void {
    const db = getDb()
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM deployment_tags WHERE deployment_id = ?').run(deploymentId)
      const insert = db.prepare('INSERT INTO deployment_tags (deployment_id, tag_id) VALUES (?, ?)')
      for (const tagId of tagIds) {
        insert.run(deploymentId, tagId)
      }
    })
    transaction()
  }
}
