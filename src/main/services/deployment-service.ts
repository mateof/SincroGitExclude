import { v4 as uuidv4 } from 'uuid'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, unlinkSync, rmSync } from 'fs'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { GitService } from '../git/git-service'
import { GitExcludeService } from '../git/git-exclude'
import { WatcherService } from './watcher-service'
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

  private getBundleExcludePaths(bundleFiles: string[], fileRelativePath: string): string[] {
    const base = fileRelativePath.replace(/[\\/]+$/, '').replace(/\\/g, '/')
    return bundleFiles.map((f) => (base && base !== '.' ? `${base}/${f}` : f))
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

    // Validate repo path is a git repo
    if (!this.excludeService.isGitRepo(repoPath)) {
      throw new Error(`${repoPath} is not a git repository`)
    }

    await this.gitService.withLock(internalRepoPath, async () => {
      // Create branch from source
      let startPoint = sourceBranch
      if (sourceCommit) {
        startPoint = sourceCommit
      }
      await this.gitService.createBranch(internalRepoPath, branchName, startPoint)

      if (isBundle) {
        // Bundle: handle multi-file deployment
        const bundleFiles = await this.gitService.listFiles(internalRepoPath)
        const deployBasePath = join(repoPath, fileRelativePath)

        let imported = false
        for (const relPath of bundleFiles) {
          const deployedPath = join(deployBasePath, relPath)
          const internalPath = join(internalRepoPath, relPath)

          if (existsSync(deployedPath)) {
            // Import existing file
            copyFileSync(deployedPath, internalPath)
            imported = true
          } else {
            // Copy from internal repo to deployed location
            mkdirSync(dirname(deployedPath), { recursive: true })
            copyFileSync(internalPath, deployedPath)
          }
        }

        if (imported) {
          try {
            await this.gitService.addAllAndCommit(
              internalRepoPath,
              'Import existing file content'
            )
          } catch {
            // No changes - files are same as source
          }
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
    })

    // Insert into DB
    getDb()
      .prepare(
        `INSERT INTO deployments (id, file_id, repo_path, file_relative_path, branch_name, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .run(id, fileId, repoPath, fileRelativePath, branchName)

    // Add to git exclude (if enabled)
    if (autoExclude) {
      if (isBundle) {
        const bundleFiles = await this.gitService.listFiles(internalRepoPath)
        const excludePaths = this.getBundleExcludePaths(bundleFiles, fileRelativePath)
        await this.excludeService.addExclusions(repoPath, excludePaths, id)
      } else {
        await this.excludeService.addExclusion(repoPath, fileRelativePath, id)
      }
    }

    // Start watching
    const watchPath = isBundle
      ? join(repoPath, fileRelativePath)
      : join(repoPath, fileRelativePath)
    await this.watcherService.watchDeployment(id, watchPath)

    log.info(`Created deployment ${id} for ${fileType} ${fileId} at ${watchPath}`)
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

    let count = 0
    const fileIds = new Set<string>()
    for (const d of activeDeployments) {
      try {
        const hasChanges = await this.checkForChanges(d.id)
        if (hasChanges) {
          count++
          fileIds.add(d.file_id)
        }
      } catch {
        // Skip deployments that can't be checked
      }
    }
    return { count, fileIds: [...fileIds] }
  }

  listDeployments(fileId: string): DeploymentRow[] {
    return getDb()
      .prepare('SELECT * FROM deployments WHERE file_id = ? ORDER BY created_at DESC')
      .all(fileId) as DeploymentRow[]
  }

  async deactivateDeployment(id: string): Promise<void> {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    getDb()
      .prepare('UPDATE deployments SET is_active = 0 WHERE id = ?')
      .run(id)

    // Stop watching
    await this.watcherService.unwatchDeployment(id)

    // Remove from git exclude
    const fileType = this.getFileType(deployment.file_id)
    if (fileType === 'bundle') {
      const internalRepoPath = join(FILES_DIR, deployment.file_id)
      const bundleFiles = await this.gitService.listFiles(internalRepoPath)
      const excludePaths = this.getBundleExcludePaths(bundleFiles, deployment.file_relative_path)
      await this.excludeService.removeExclusions(deployment.repo_path, excludePaths, id)
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

    // Re-add to git exclude
    const fileType = this.getFileType(deployment.file_id)
    if (fileType === 'bundle') {
      const internalRepoPath = join(FILES_DIR, deployment.file_id)
      const bundleFiles = await this.gitService.listFiles(internalRepoPath)
      const excludePaths = this.getBundleExcludePaths(bundleFiles, deployment.file_relative_path)
      await this.excludeService.addExclusions(deployment.repo_path, excludePaths, id)
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
        const internalRepoPath = join(FILES_DIR, deployment.file_id)
        const bundleFiles = await this.gitService.listFiles(internalRepoPath)
        const excludePaths = this.getBundleExcludePaths(
          bundleFiles,
          deployment.file_relative_path
        )
        await this.excludeService.removeExclusions(deployment.repo_path, excludePaths, id)
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

    // Delete from DB
    getDb().prepare('DELETE FROM deployments WHERE id = ?').run(id)

    log.info(`Deleted deployment ${id}${deleteFromDisk ? ' (files removed from disk)' : ''}`)
  }

  async syncDeployment(id: string): Promise<void> {
    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error('Deployment not found')

    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType === 'bundle') {
      const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
      if (!existsSync(deployBasePath)) {
        throw new Error('Deployed directory does not exist')
      }

      await this.gitService.withLock(internalRepoPath, async () => {
        await this.gitService.checkout(internalRepoPath, deployment.branch_name)

        const bundleFiles = await this.gitService.listFiles(internalRepoPath)
        for (const relPath of bundleFiles) {
          const deployedPath = join(deployBasePath, relPath)
          const internalPath = join(internalRepoPath, relPath)
          if (existsSync(deployedPath)) {
            copyFileSync(deployedPath, internalPath)
          }
        }
      })
    } else {
      const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
      if (!existsSync(deployedFullPath)) {
        throw new Error('Deployed file does not exist')
      }

      await this.gitService.withLock(internalRepoPath, async () => {
        await this.gitService.checkout(internalRepoPath, deployment.branch_name)

        const content = readFileSync(deployedFullPath)
        writeFileSync(join(internalRepoPath, 'content'), content)
      })
    }

    getDb()
      .prepare("UPDATE deployments SET last_synced_at = datetime('now') WHERE id = ?")
      .run(id)
  }

  async checkForChanges(id: string): Promise<boolean> {
    const deployment = this.getDeployment(id)
    if (!deployment) return false

    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType === 'bundle') {
      const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
      if (!existsSync(deployBasePath)) return false

      return this.gitService.withLock(internalRepoPath, async () => {
        const currentBranch = await this.gitService.getCurrentBranch(internalRepoPath)

        try {
          await this.gitService.checkout(internalRepoPath, deployment.branch_name)

          const bundleFiles = await this.gitService.listFiles(internalRepoPath)

          // Save originals
          const originals = new Map<string, Buffer>()
          for (const relPath of bundleFiles) {
            const internalPath = join(internalRepoPath, relPath)
            if (existsSync(internalPath)) {
              originals.set(relPath, readFileSync(internalPath))
            }
          }

          // Copy deployed files to internal repo
          for (const relPath of bundleFiles) {
            const deployedPath = join(deployBasePath, relPath)
            const internalPath = join(internalRepoPath, relPath)
            if (existsSync(deployedPath)) {
              copyFileSync(deployedPath, internalPath)
            }
          }

          const hasChanges = await this.gitService.hasChanges(internalRepoPath)

          // Restore originals
          for (const [relPath, content] of originals) {
            writeFileSync(join(internalRepoPath, relPath), content)
          }

          return hasChanges
        } finally {
          if (currentBranch !== deployment.branch_name) {
            await this.gitService.checkout(internalRepoPath, currentBranch)
          }
        }
      })
    } else {
      const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
      if (!existsSync(deployedFullPath)) return false

      return this.gitService.withLock(internalRepoPath, async () => {
        const currentBranch = await this.gitService.getCurrentBranch(internalRepoPath)

        try {
          await this.gitService.checkout(internalRepoPath, deployment.branch_name)

          const deployedContent = readFileSync(deployedFullPath)
          const internalContentPath = join(internalRepoPath, 'content')
          const originalContent = readFileSync(internalContentPath)

          writeFileSync(internalContentPath, deployedContent)
          const hasChanges = await this.gitService.hasChanges(internalRepoPath)

          // Restore original content
          writeFileSync(internalContentPath, originalContent)

          return hasChanges
        } finally {
          if (currentBranch !== deployment.branch_name) {
            await this.gitService.checkout(internalRepoPath, currentBranch)
          }
        }
      })
    }
  }

  async checkExcludeStatus(id: string): Promise<boolean> {
    const deployment = this.getDeployment(id)
    if (!deployment) return false

    const fileType = this.getFileType(deployment.file_id)
    if (fileType === 'bundle') {
      const internalRepoPath = join(FILES_DIR, deployment.file_id)
      const bundleFiles = await this.gitService.listFiles(internalRepoPath)
      const excludePaths = this.getBundleExcludePaths(bundleFiles, deployment.file_relative_path)

      for (const p of excludePaths) {
        const excluded = await this.excludeService.isExcluded(deployment.repo_path, p)
        if (!excluded) return false
      }
      return excludePaths.length > 0
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
}
