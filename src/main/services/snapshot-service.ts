import { v4 as uuidv4 } from 'uuid'
import { join, relative } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { deflateSync, inflateSync } from 'zlib'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { GitService } from '../git/git-service'
import type { DeploymentService } from './deployment-service'
import log from 'electron-log'

interface DeploymentRow {
  id: string
  file_id: string
  repo_path: string
  file_relative_path: string
  branch_name: string
  current_commit_hash: string | null
}

export interface SnapshotInfo {
  id: string
  deploymentId: string
  baseCommitHash: string | null
  createdAt: string
  fileCount: number
  totalSize: number
}

export class SnapshotService {
  private enabled: boolean = true
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private pendingChanges: Map<string, Set<string>> = new Map()
  private deploymentService: DeploymentService | null = null

  constructor(private gitService: GitService) {}

  setDeploymentService(ds: DeploymentService): void {
    this.deploymentService = ds
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    log.info(`Snapshots ${enabled ? 'enabled' : 'disabled'}`)
  }

  isEnabled(): boolean {
    return this.enabled
  }

  onFileChanged(deploymentId: string, changedPath: string): void {
    if (!this.enabled) return

    const pending = this.pendingChanges.get(deploymentId) || new Set()
    pending.add(changedPath)
    this.pendingChanges.set(deploymentId, pending)

    const existingTimer = this.debounceTimers.get(deploymentId)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      this.debounceTimers.delete(deploymentId)
      this.createSnapshot(deploymentId).catch((err) => {
        log.error(`Failed to create snapshot for deployment ${deploymentId}:`, err)
      })
    }, 2000)

    this.debounceTimers.set(deploymentId, timer)
  }

  private getDeployment(deploymentId: string): DeploymentRow {
    const row = getDb()
      .prepare('SELECT id, file_id, repo_path, file_relative_path, branch_name, current_commit_hash FROM deployments WHERE id = ?')
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

  async createSnapshot(deploymentId: string): Promise<SnapshotInfo | null> {
    const changedPaths = this.pendingChanges.get(deploymentId)
    if (!changedPaths || changedPaths.size === 0) return null
    this.pendingChanges.delete(deploymentId)

    try {
      const deployment = this.getDeployment(deploymentId)
      const fileType = this.getFileType(deployment.file_id)
      const baseCommitHash = deployment.current_commit_hash || null
      const snapshotId = uuidv4()

      const db = getDb()
      const filesToStore: Array<{ path: string; content: Buffer; size: number }> = []

      if (fileType === 'bundle') {
        const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
        for (const fullPath of changedPaths) {
          if (!existsSync(fullPath)) continue
          const relPath = relative(deployBasePath, fullPath).replace(/\\/g, '/')
          if (relPath.startsWith('..')) continue
          const raw = readFileSync(fullPath)
          filesToStore.push({
            path: relPath,
            content: deflateSync(raw),
            size: raw.length
          })
        }
      } else {
        const deployedPath = join(deployment.repo_path, deployment.file_relative_path)
        if (!existsSync(deployedPath)) return null
        const raw = readFileSync(deployedPath)
        filesToStore.push({
          path: 'content',
          content: deflateSync(raw),
          size: raw.length
        })
      }

      if (filesToStore.length === 0) return null

      const transaction = db.transaction(() => {
        db.prepare('INSERT INTO snapshots (id, deployment_id, base_commit_hash) VALUES (?, ?, ?)').run(
          snapshotId,
          deploymentId,
          baseCommitHash
        )

        const insertFile = db.prepare(
          'INSERT INTO snapshot_files (snapshot_id, file_path, content, size) VALUES (?, ?, ?, ?)'
        )
        for (const f of filesToStore) {
          insertFile.run(snapshotId, f.path, f.content, f.size)
        }
      })
      transaction()

      log.debug(
        `Created snapshot ${snapshotId.substring(0, 8)} for deployment ${deploymentId.substring(0, 8)} (${filesToStore.length} files)`
      )

      return {
        id: snapshotId,
        deploymentId,
        baseCommitHash,
        createdAt: new Date().toISOString(),
        fileCount: filesToStore.length,
        totalSize: filesToStore.reduce((sum, f) => sum + f.size, 0)
      }
    } catch (err) {
      log.error(`Error creating snapshot for ${deploymentId}:`, err)
      return null
    }
  }

  getSnapshotsBetweenCommits(
    deploymentId: string,
    commitHash: string | null,
    nextCommitHash?: string | null
  ): SnapshotInfo[] {
    const db = getDb()

    type SnapshotRow = {
      id: string
      deployment_id: string
      base_commit_hash: string | null
      created_at: string
      file_count: number
      total_size: number
    }

    const query = `SELECT s.id, s.deployment_id, s.base_commit_hash, s.created_at,
      (SELECT COUNT(*) FROM snapshot_files sf WHERE sf.snapshot_id = s.id) as file_count,
      (SELECT COALESCE(SUM(sf.size), 0) FROM snapshot_files sf WHERE sf.snapshot_id = s.id) as total_size
     FROM snapshots s
     WHERE s.deployment_id = ? AND s.base_commit_hash IS ?
     ORDER BY s.created_at DESC`

    const rows = db.prepare(query).all(deploymentId, commitHash) as SnapshotRow[]

    return rows.map((r) => ({
      id: r.id,
      deploymentId: r.deployment_id,
      baseCommitHash: r.base_commit_hash,
      createdAt: r.created_at,
      fileCount: r.file_count,
      totalSize: r.total_size
    }))
  }

  getSnapshotCountForCommit(
    deploymentId: string,
    commitHash: string | null
  ): number {
    const row = getDb()
      .prepare(
        'SELECT COUNT(*) as count FROM snapshots WHERE deployment_id = ? AND base_commit_hash IS ?'
      )
      .get(deploymentId, commitHash) as { count: number }
    return row.count
  }

  getSnapshotFiles(snapshotId: string): Array<{ path: string; content: string }> {
    const rows = getDb()
      .prepare('SELECT file_path, content FROM snapshot_files WHERE snapshot_id = ?')
      .all(snapshotId) as Array<{ file_path: string; content: Buffer }>

    return rows.map((r) => ({
      path: r.file_path,
      content: inflateSync(r.content).toString('utf-8')
    }))
  }

  async getFullStateAtSnapshot(
    snapshotId: string
  ): Promise<Array<{ path: string; content: string }>> {
    const snapshot = getDb()
      .prepare('SELECT * FROM snapshots WHERE id = ?')
      .get(snapshotId) as {
      id: string
      deployment_id: string
      base_commit_hash: string | null
      created_at: string
    } | undefined

    if (!snapshot) throw new Error('Snapshot not found')

    const deployment = this.getDeployment(snapshot.deployment_id)
    const fileType = this.getFileType(deployment.file_id)
    const internalRepoPath = join(FILES_DIR, deployment.file_id)

    // Start with files from the base commit
    const fileMap = new Map<string, string>()

    if (snapshot.base_commit_hash) {
      await this.gitService.withLock(internalRepoPath, async () => {
        if (fileType === 'bundle') {
          const files = await this.gitService.listFilesAtCommit(
            internalRepoPath,
            snapshot.base_commit_hash!
          )
          for (const relPath of files) {
            try {
              const content = await this.gitService.getFileAtCommit(
                internalRepoPath,
                snapshot.base_commit_hash!,
                relPath
              )
              fileMap.set(relPath, content)
            } catch {
              // Skip files that can't be read
            }
          }
        } else {
          try {
            const content = await this.gitService.getFileAtCommit(
              internalRepoPath,
              snapshot.base_commit_hash!,
              'content'
            )
            fileMap.set('content', content)
          } catch {
            // No base content
          }
        }
      })
    }

    // Overlay all snapshots from the same deployment+base_commit up to this one
    const allSnapshots = getDb()
      .prepare(
        `SELECT s.id FROM snapshots s
         WHERE s.deployment_id = ? AND s.base_commit_hash IS ?
         AND s.created_at <= ?
         ORDER BY s.created_at DESC`
      )
      .all(snapshot.deployment_id, snapshot.base_commit_hash, snapshot.created_at) as Array<{
      id: string
    }>

    for (const s of allSnapshots) {
      const files = this.getSnapshotFiles(s.id)
      for (const f of files) {
        fileMap.set(f.path, f.content)
      }
    }

    return Array.from(fileMap.entries()).map(([path, content]) => ({ path, content }))
  }

  async applySnapshot(snapshotId: string): Promise<void> {
    const snapshot = getDb()
      .prepare('SELECT * FROM snapshots WHERE id = ?')
      .get(snapshotId) as {
      id: string
      deployment_id: string
    } | undefined

    if (!snapshot) throw new Error('Snapshot not found')

    const deployment = this.getDeployment(snapshot.deployment_id)
    const fileType = this.getFileType(deployment.file_id)
    const fullState = await this.getFullStateAtSnapshot(snapshotId)

    if (fileType === 'bundle') {
      const deployBasePath = join(deployment.repo_path, deployment.file_relative_path)
      for (const file of fullState) {
        const destPath = join(deployBasePath, file.path)
        mkdirSync(join(destPath, '..'), { recursive: true })
        writeFileSync(destPath, file.content, 'utf-8')
      }
    } else {
      const deployedPath = join(deployment.repo_path, deployment.file_relative_path)
      const contentFile = fullState.find((f) => f.path === 'content')
      if (contentFile) {
        writeFileSync(deployedPath, contentFile.content, 'utf-8')
      }
    }

    log.info(`Applied snapshot ${snapshotId.substring(0, 8)} to deployment ${snapshot.deployment_id.substring(0, 8)}`)
  }

  async deploySnapshot(
    snapshotId: string,
    destFolder: string
  ): Promise<{ deploymentId: string } | null> {
    if (!this.deploymentService) throw new Error('DeploymentService not set')

    const snapshot = getDb()
      .prepare('SELECT * FROM snapshots WHERE id = ?')
      .get(snapshotId) as {
      id: string
      deployment_id: string
      base_commit_hash: string | null
    } | undefined

    if (!snapshot) throw new Error('Snapshot not found')

    const sourceDeployment = this.getDeployment(snapshot.deployment_id)
    const fileType = this.getFileType(sourceDeployment.file_id)

    // Resolve dest folder to git repo
    const { existsSync: fsExists } = await import('fs')
    const { dirname: pathDirname, sep: pathSep } = await import('path')

    let dir = destFolder
    let gitRoot: string | null = null
    while (true) {
      if (fsExists(join(dir, '.git'))) {
        gitRoot = dir
        break
      }
      const parent = pathDirname(dir)
      if (parent === dir) break
      dir = parent
    }

    if (!gitRoot) {
      throw new Error('Destination must be inside a git repository')
    }

    // Compute relative path
    let relativePath = relative(gitRoot, destFolder).replace(/\\/g, '/') || '.'
    if (fileType === 'file') {
      // For single files, append file name
      const fileName = sourceDeployment.file_relative_path.split(/[/\\]/).pop() || 'content'
      relativePath = relativePath === '.' ? fileName : `${relativePath}/${fileName}`
    }

    const autoExclude = true

    // Create deployment from base commit
    const newDeployment = await this.deploymentService.createDeployment(
      sourceDeployment.file_id,
      gitRoot,
      relativePath,
      undefined,
      snapshot.base_commit_hash || undefined,
      autoExclude
    )

    // Apply snapshot content to the new deployment location
    const fullState = await this.getFullStateAtSnapshot(snapshotId)

    if (fileType === 'bundle') {
      const deployBasePath = join(gitRoot, relativePath)
      for (const file of fullState) {
        const destPath = join(deployBasePath, file.path)
        mkdirSync(join(destPath, '..'), { recursive: true })
        writeFileSync(destPath, file.content, 'utf-8')
      }
    } else {
      const deployedPath = join(gitRoot, relativePath)
      const contentFile = fullState.find((f) => f.path === 'content')
      if (contentFile) {
        writeFileSync(deployedPath, contentFile.content, 'utf-8')
      }
    }

    log.info(
      `Deployed snapshot ${snapshotId.substring(0, 8)} to ${destFolder}`
    )

    return { deploymentId: newDeployment.id }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
    this.pendingChanges.clear()
  }
}
