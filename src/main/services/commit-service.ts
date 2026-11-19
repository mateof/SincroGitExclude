import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { GitService, CommitLogEntry } from '../git/git-service'
import { scanDirectory, matchesAnyPattern } from '../utils/file-scanner'
import {
  commitChanges,
  diffWorking,
  listChangesWithStats,
  listTrackedFiles,
  restoreFromCommit
} from '../git/deployed-tree'
import { treeOf } from './deployment-context'
import { changeStatus } from './change-status'
import log from 'electron-log'

interface DeploymentRow {
  id: string
  file_id: string
  repo_path: string
  file_relative_path: string
  branch_name: string
}

export class CommitService {
  constructor(private gitService: GitService) {}

  private getDeployment(deploymentId: string): DeploymentRow {
    const row = getDb()
      .prepare('SELECT * FROM deployments WHERE id = ?')
      .get(deploymentId) as DeploymentRow | undefined

    if (!row) throw new Error('Deployment not found')
    return row
  }

  private getFileType(fileId: string): string {
    const row = getDb()
      .prepare('SELECT type FROM files WHERE id = ?')
      .get(fileId) as { type: string } | undefined
    return row?.type ?? 'file'
  }

  private getIgnorePatterns(fileId: string): string[] {
    const row = getDb()
      .prepare('SELECT ignore_patterns FROM files WHERE id = ?')
      .get(fileId) as { ignore_patterns: string } | undefined
    const raw = row?.ignore_patterns ?? ''
    return raw.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'))
  }

  private async writeSingleFile(
    internalRepoPath: string,
    commitHash: string,
    deployedFullPath: string
  ): Promise<void> {
    const content = await this.gitService.readFileForCheckout(internalRepoPath, commitHash, 'content')
    mkdirSync(dirname(deployedFullPath), { recursive: true })
    writeFileSync(deployedFullPath, content)
  }

  async listCommits(deploymentId: string): Promise<CommitLogEntry[]> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)

    return this.gitService.withLock(internalRepoPath, async () => {
      return this.gitService.getLog(internalRepoPath, deployment.branch_name)
    })
  }

  async getChangedFiles(
    deploymentId: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType !== 'bundle') return []

    const tree = treeOf(deployment)
    if (!existsSync(tree.workTree)) return []

    const changes = await this.gitService.withLock(internalRepoPath, () =>
      listChangesWithStats(tree)
    )
    changeStatus.set(deploymentId, changes.length > 0)
    return changes.map((c) => ({
      path: c.path,
      status: c.kind,
      additions: c.additions,
      deletions: c.deletions
    }))
  }

  async createCommit(
    deploymentId: string,
    message: string,
    tag?: string,
    selectedFiles?: string[]
  ): Promise<CommitLogEntry> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const isBundle = fileType === 'bundle'

    const result = await this.gitService.withLock(internalRepoPath, async () => {
      let commitHash: string

      if (isBundle) {
        const tree = treeOf(deployment)
        if (!existsSync(tree.workTree)) {
          throw new Error('Deployed directory does not exist')
        }
        commitHash = await commitChanges(tree, message, selectedFiles)
      } else {
        await this.gitService.checkout(internalRepoPath, deployment.branch_name)

        // Copy deployed file content into internal repo
        const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
        if (!existsSync(deployedFullPath)) {
          throw new Error('Deployed file does not exist')
        }

        const content = readFileSync(deployedFullPath)
        writeFileSync(join(internalRepoPath, 'content'), content)

        commitHash = await this.gitService.addAndCommit(
          internalRepoPath,
          'content',
          message
        )
      }

      // Tag if requested
      const fullTag = tag ? `${deployment.branch_name}/${tag}` : undefined
      if (fullTag) {
        await this.gitService.addTag(internalRepoPath, fullTag, commitHash)
      }

      // Update sync time and current commit
      getDb()
        .prepare("UPDATE deployments SET last_synced_at = datetime('now'), current_commit_hash = ? WHERE id = ?")
        .run(commitHash, deploymentId)

      log.info(`Committed ${commitHash} for deployment ${deploymentId}: ${message}`)

      return {
        hash: commitHash,
        message,
        date: new Date().toISOString(),
        tag: fullTag
      }
    })

    changeStatus.invalidate(deploymentId)
    return result
  }

  async checkoutToCommit(
    deploymentId: string,
    commitHash: string
  ): Promise<void> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const isBundle = fileType === 'bundle'

    await this.gitService.withLock(internalRepoPath, async () => {
      if (isBundle) {
        await restoreFromCommit(treeOf(deployment), commitHash)
      } else {
        await this.writeSingleFile(
          internalRepoPath,
          commitHash,
          join(deployment.repo_path, deployment.file_relative_path)
        )
      }
    })

    // Save the checked-out commit hash
    getDb()
      .prepare('UPDATE deployments SET current_commit_hash = ? WHERE id = ?')
      .run(commitHash, deploymentId)
    changeStatus.invalidate(deploymentId)

    log.info(`Checked out ${commitHash} for deployment ${deploymentId}`)
  }

  async getDiff(
    deploymentId: string,
    hash1: string,
    hash2?: string
  ): Promise<string> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const filterContent = fileType !== 'bundle'

    return this.gitService.withLock(internalRepoPath, async () => {
      return this.gitService.getDiff(internalRepoPath, hash1, hash2, filterContent)
    })
  }

  async getDiffWorking(deploymentId: string): Promise<string> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const isBundle = fileType === 'bundle'

    if (isBundle) {
      const tree = treeOf(deployment)
      if (!existsSync(tree.workTree)) return ''
      return this.gitService.withLock(internalRepoPath, () => diffWorking(tree))
    }

    return this.gitService.withLock(internalRepoPath, async () => {
      // Ensure correct branch
      await this.gitService.checkout(internalRepoPath, deployment.branch_name)

      const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
      if (!existsSync(deployedFullPath)) return ''

      const contentPath = join(internalRepoPath, 'content')
      const originalContent = readFileSync(contentPath)

      const currentContent = readFileSync(deployedFullPath)
      writeFileSync(contentPath, currentContent)

      const diff = await this.gitService.getDiffWorkingTree(internalRepoPath, false)

      writeFileSync(contentPath, originalContent)

      return diff
    })
  }

  async getFileAtCommit(
    deploymentId: string,
    commitHash: string
  ): Promise<string> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType === 'bundle') {
      // For bundles, return all files concatenated with path headers
      const files = await this.gitService.listFilesAtCommit(internalRepoPath, commitHash)
      const contents = await this.gitService.readFiles(internalRepoPath, commitHash, files)
      return files
        .map((relPath) => {
          const content = contents.get(relPath)
          return `=== ${relPath} ===\n${content ? content.toString('utf-8') : '[Could not read file]'}`
        })
        .join('\n\n')
    }

    return this.gitService.getFileAtCommit(internalRepoPath, commitHash, 'content')
  }

  async getCurrentFiles(
    deploymentId: string
  ): Promise<Array<{ path: string; content: string }>> {
    const deployment = this.getDeployment(deploymentId)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType === 'bundle') {
      const internalRepoPath = join(FILES_DIR, deployment.file_id)
      const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
      const ignorePatterns = this.getIgnorePatterns(deployment.file_id)
      const bundleFiles = await this.gitService.listFiles(internalRepoPath)
      const result: Array<{ path: string; content: string }> = []

      for (const relPath of bundleFiles) {
        if (matchesAnyPattern(relPath, ignorePatterns)) continue
        const deployedPath = join(deployBasePath, relPath)
        try {
          if (existsSync(deployedPath)) {
            result.push({ path: relPath, content: readFileSync(deployedPath, 'utf-8') })
          } else {
            result.push({ path: relPath, content: '[File not found]' })
          }
        } catch {
          result.push({ path: relPath, content: '[Could not read file]' })
        }
      }

      // Also include new (untracked) files from deployed dir
      if (existsSync(deployBasePath)) {
        const deployedFiles = scanDirectory(deployBasePath, ignorePatterns)
        const trackedSet = new Set(bundleFiles)
        for (const relPath of deployedFiles) {
          if (!trackedSet.has(relPath)) {
            const deployedPath = join(deployBasePath, relPath)
            try {
              result.push({ path: relPath, content: readFileSync(deployedPath, 'utf-8') })
            } catch {
              result.push({ path: relPath, content: '[Could not read file]' })
            }
          }
        }
      }

      return result
    }

    const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
    if (!existsSync(deployedFullPath)) {
      return [{ path: deployment.file_relative_path, content: '[File not found]' }]
    }
    const content = readFileSync(deployedFullPath, 'utf-8')
    return [{ path: deployment.file_relative_path, content }]
  }

  async getFilesAtCommit(
    deploymentId: string,
    commitHash: string
  ): Promise<Array<{ path: string; content: string }>> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType === 'bundle') {
      const files = await this.gitService.listFilesAtCommit(internalRepoPath, commitHash)
      const contents = await this.gitService.readFiles(internalRepoPath, commitHash, files)
      return files.map((relPath) => ({
        path: relPath,
        content: contents.get(relPath)?.toString('utf-8') ?? '[Could not read file]'
      }))
    }

    const content = await this.gitService.getFileAtCommit(internalRepoPath, commitHash, 'content')
    return [{ path: deployment.file_relative_path, content }]
  }

  async restoreFilesFromCommit(
    deploymentId: string,
    commitHash: string,
    filePaths: string[]
  ): Promise<void> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const isBundle = fileType === 'bundle'

    await this.gitService.withLock(internalRepoPath, async () => {
      if (isBundle) {
        await restoreFromCommit(treeOf(deployment), commitHash, filePaths)
      } else if (filePaths.length > 0) {
        await this.writeSingleFile(
          internalRepoPath,
          commitHash,
          join(deployment.repo_path, deployment.file_relative_path)
        )
      }
    })
    changeStatus.invalidate(deploymentId)

    log.info(`Restored ${filePaths.length} file(s) from commit ${commitHash.substring(0, 7)} for deployment ${deploymentId}`)
  }

  async getCrossDiff(
    targetDeploymentId: string,
    sourceCommitHash: string
  ): Promise<string> {
    const target = this.getDeployment(targetDeploymentId)
    const internalRepoPath = join(FILES_DIR, target.file_id)
    const fileType = this.getFileType(target.file_id)
    const filterContent = fileType !== 'bundle'

    return this.gitService.withLock(internalRepoPath, async () => {
      const targetHead = await this.gitService.getBranchHead(internalRepoPath, target.branch_name)
      return this.gitService.getDiff(internalRepoPath, targetHead, sourceCommitHash, filterContent)
    })
  }

  async applyFromCommit(
    targetDeploymentId: string,
    sourceCommitHash: string,
    message?: string
  ): Promise<CommitLogEntry> {
    const target = this.getDeployment(targetDeploymentId)
    const internalRepoPath = join(FILES_DIR, target.file_id)
    const fileType = this.getFileType(target.file_id)
    const isBundle = fileType === 'bundle'
    const commitMsg = message || `Applied from ${sourceCommitHash.substring(0, 7)}`

    const commitHash = await this.gitService.withLock(internalRepoPath, async () => {
      if (isBundle) {
        const tree = treeOf(target)
        const sourceFiles = await this.gitService.listFilesAtCommit(internalRepoPath, sourceCommitHash)
        await restoreFromCommit(tree, sourceCommitHash)
        return commitChanges(tree, commitMsg, sourceFiles)
      }

      const deployedFullPath = join(target.repo_path, target.file_relative_path)
      await this.writeSingleFile(internalRepoPath, sourceCommitHash, deployedFullPath)
      await this.gitService.checkout(internalRepoPath, target.branch_name)
      writeFileSync(join(internalRepoPath, 'content'), readFileSync(deployedFullPath))
      return this.gitService.addAndCommit(internalRepoPath, 'content', commitMsg)
    })

    getDb()
      .prepare("UPDATE deployments SET last_synced_at = datetime('now'), current_commit_hash = ? WHERE id = ?")
      .run(commitHash, targetDeploymentId)
    changeStatus.invalidate(targetDeploymentId)

    log.info(`Applied ${sourceCommitHash.substring(0, 7)} to deployment ${targetDeploymentId}: ${commitMsg}`)

    return {
      hash: commitHash,
      message: commitMsg,
      date: new Date().toISOString()
    }
  }

  async discardFiles(deploymentId: string, filePaths: string[]): Promise<void> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)

    if (fileType !== 'bundle') {
      throw new Error('discardFiles is only supported for bundles')
    }

    await this.gitService.withLock(internalRepoPath, async () => {
      const tree = treeOf(deployment)
      const tracked = new Set(await listTrackedFiles(tree))
      const restorable = filePaths.filter((p) => tracked.has(p))
      const untracked = filePaths.filter((p) => !tracked.has(p))
      if (untracked.length > 0) {
        log.info(`Discard skipped ${untracked.length} untracked file(s) for deployment ${deploymentId}`)
      }
      await restoreFromCommit(tree, `refs/heads/${deployment.branch_name}`, restorable)
    })
    changeStatus.invalidate(deploymentId)

    log.info(`Discarded ${filePaths.length} files for deployment ${deploymentId}`)
  }

  async discardChanges(deploymentId: string): Promise<void> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)

    const headHash = await this.gitService.withLock(internalRepoPath, () =>
      this.gitService.getBranchHead(internalRepoPath, deployment.branch_name)
    )

    await this.checkoutToCommit(deploymentId, headHash)
    log.info(`Discarded changes for deployment ${deploymentId}`)
  }
}
