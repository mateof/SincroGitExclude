import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { GitService, CommitLogEntry } from '../git/git-service'
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

  async listCommits(deploymentId: string): Promise<CommitLogEntry[]> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)

    return this.gitService.withLock(internalRepoPath, async () => {
      return this.gitService.getLog(internalRepoPath, deployment.branch_name)
    })
  }

  async createCommit(
    deploymentId: string,
    message: string,
    tag?: string
  ): Promise<CommitLogEntry> {
    const deployment = this.getDeployment(deploymentId)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)
    const fileType = this.getFileType(deployment.file_id)
    const isBundle = fileType === 'bundle'

    return this.gitService.withLock(internalRepoPath, async () => {
      // Switch to deployment's branch
      await this.gitService.checkout(internalRepoPath, deployment.branch_name)

      let commitHash: string

      if (isBundle) {
        // Copy all deployed files into internal repo
        const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
        if (!existsSync(deployBasePath)) {
          throw new Error('Deployed directory does not exist')
        }

        const bundleFiles = await this.gitService.listFiles(internalRepoPath)
        for (const relPath of bundleFiles) {
          const deployedPath = join(deployBasePath, relPath)
          const internalPath = join(internalRepoPath, relPath)
          if (existsSync(deployedPath)) {
            copyFileSync(deployedPath, internalPath)
          }
        }

        commitHash = await this.gitService.addAllAndCommit(internalRepoPath, message)
      } else {
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
        await this.gitService.addTag(internalRepoPath, fullTag)
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
        const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)

        // List files at the specified commit
        const files = await this.gitService.listFilesAtCommit(internalRepoPath, commitHash)

        // Ensure we're on the right branch
        await this.gitService.checkout(internalRepoPath, deployment.branch_name)

        for (const relPath of files) {
          const content = await this.gitService.getFileAtCommit(
            internalRepoPath,
            commitHash,
            relPath
          )

          // Write to deployed location
          const deployedPath = join(deployBasePath, relPath)
          mkdirSync(dirname(deployedPath), { recursive: true })
          writeFileSync(deployedPath, content, 'utf-8')

          // Also update internal repo working copy
          writeFileSync(join(internalRepoPath, relPath), content, 'utf-8')
        }
      } else {
        // Single file
        const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)

        const fileContent = await this.gitService.getFileAtCommit(
          internalRepoPath,
          commitHash,
          'content'
        )

        writeFileSync(deployedFullPath, fileContent, 'utf-8')

        await this.gitService.checkout(internalRepoPath, deployment.branch_name)
        writeFileSync(join(internalRepoPath, 'content'), fileContent, 'utf-8')
      }
    })

    // Save the checked-out commit hash
    getDb()
      .prepare('UPDATE deployments SET current_commit_hash = ? WHERE id = ?')
      .run(commitHash, deploymentId)

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

    return this.gitService.withLock(internalRepoPath, async () => {
      // Ensure correct branch
      await this.gitService.checkout(internalRepoPath, deployment.branch_name)

      if (isBundle) {
        const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
        if (!existsSync(deployBasePath)) return ''

        const bundleFiles = await this.gitService.listFiles(internalRepoPath)

        // Save originals
        const originals = new Map<string, Buffer>()
        for (const relPath of bundleFiles) {
          const internalPath = join(internalRepoPath, relPath)
          if (existsSync(internalPath)) {
            originals.set(relPath, readFileSync(internalPath))
          }
        }

        // Copy deployed files into internal repo
        for (const relPath of bundleFiles) {
          const deployedPath = join(deployBasePath, relPath)
          const internalPath = join(internalRepoPath, relPath)
          if (existsSync(deployedPath)) {
            copyFileSync(deployedPath, internalPath)
          }
        }

        // Get diff without content filter
        const diff = await this.gitService.getDiffWorkingTree(internalRepoPath, false)

        // Restore originals
        for (const [relPath, content] of originals) {
          writeFileSync(join(internalRepoPath, relPath), content)
        }

        return diff
      } else {
        // Single file
        const deployedFullPath = join(deployment.repo_path, deployment.file_relative_path)
        if (!existsSync(deployedFullPath)) return ''

        const contentPath = join(internalRepoPath, 'content')
        const originalContent = readFileSync(contentPath)

        const currentContent = readFileSync(deployedFullPath)
        writeFileSync(contentPath, currentContent)

        const diff = await this.gitService.getDiffWorkingTree(internalRepoPath)

        // Restore original content
        writeFileSync(contentPath, originalContent)

        return diff
      }
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
      const parts: string[] = []

      for (const relPath of files) {
        try {
          const content = await this.gitService.getFileAtCommit(
            internalRepoPath,
            commitHash,
            relPath
          )
          parts.push(`=== ${relPath} ===\n${content}`)
        } catch {
          parts.push(`=== ${relPath} ===\n[Could not read file]`)
        }
      }

      return parts.join('\n\n')
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
      const bundleFiles = await this.gitService.listFiles(internalRepoPath)
      const result: Array<{ path: string; content: string }> = []

      for (const relPath of bundleFiles) {
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
      const result: Array<{ path: string; content: string }> = []

      for (const relPath of files) {
        try {
          const content = await this.gitService.getFileAtCommit(
            internalRepoPath,
            commitHash,
            relPath
          )
          result.push({ path: relPath, content })
        } catch {
          result.push({ path: relPath, content: '[Could not read file]' })
        }
      }

      return result
    }

    const content = await this.gitService.getFileAtCommit(internalRepoPath, commitHash, 'content')
    return [{ path: deployment.file_relative_path, content }]
  }
}
