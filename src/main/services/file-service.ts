import { v4 as uuidv4 } from 'uuid'
import { join, relative, dirname } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'fs'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { GitService } from '../git/git-service'
import log from 'electron-log'

export interface ManagedFileRow {
  id: string
  name: string
  alias: string
  type: string
  use_auto_icon: number
  created_at: string
  updated_at: string
  tags?: TagRow[]
}

export interface TagRow {
  id: string
  name: string
  color: string
  fileCount?: number
}

export class FileService {
  constructor(private gitService: GitService) {}

  async createFile(name: string, alias: string, sourceFilePath?: string): Promise<ManagedFileRow> {
    const id = uuidv4()
    const repoPath = join(FILES_DIR, id)

    // Insert into DB
    getDb()
      .prepare('INSERT INTO files (id, name, alias) VALUES (?, ?, ?)')
      .run(id, name, alias)

    // Create git repo for this file
    mkdirSync(repoPath, { recursive: true })
    await this.gitService.initRepo(repoPath)

    // Copy content from source or create empty
    if (sourceFilePath && existsSync(sourceFilePath)) {
      copyFileSync(sourceFilePath, join(repoPath, 'content'))
    } else {
      writeFileSync(join(repoPath, 'content'), '', 'utf-8')
    }
    await this.gitService.addAndCommit(repoPath, 'content', 'Initial empty file')

    log.info(`Created managed file: ${name} (${id})`)

    return this.getFile(id)!
  }

  getFile(id: string): ManagedFileRow | null {
    return (
      (getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as ManagedFileRow) || null
    )
  }

  listFiles(): ManagedFileRow[] {
    const files = getDb()
      .prepare('SELECT * FROM files ORDER BY updated_at DESC')
      .all() as ManagedFileRow[]

    // Attach tags to each file
    const tagStmt = getDb().prepare(
      `SELECT t.id, t.name, t.color FROM tags t
       INNER JOIN file_tags ft ON ft.tag_id = t.id
       WHERE ft.file_id = ?`
    )

    for (const file of files) {
      file.tags = tagStmt.all(file.id) as TagRow[]
    }

    return files
  }

  updateFile(
    id: string,
    data: { name?: string; alias?: string; useAutoIcon?: boolean }
  ): ManagedFileRow {
    const fields: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) {
      fields.push('name = ?')
      values.push(data.name)
    }
    if (data.alias !== undefined) {
      fields.push('alias = ?')
      values.push(data.alias)
    }
    if (data.useAutoIcon !== undefined) {
      fields.push('use_auto_icon = ?')
      values.push(data.useAutoIcon ? 1 : 0)
    }

    if (fields.length === 0) return this.getFile(id)!

    fields.push("updated_at = datetime('now')")
    values.push(id)

    getDb()
      .prepare(`UPDATE files SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

    log.info(`Updated file ${id}`)
    return this.getFile(id)!
  }

  async deleteFile(id: string): Promise<void> {
    // Delete from DB (cascade will delete deployments and file_tags)
    getDb().prepare('DELETE FROM files WHERE id = ?').run(id)

    // Remove internal git repo directory
    const repoPath = join(FILES_DIR, id)
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }

    log.info(`Deleted file ${id}`)
  }

  async createBundle(
    name: string,
    alias: string,
    filePaths: string[],
    basePath: string
  ): Promise<ManagedFileRow> {
    const id = uuidv4()
    const repoPath = join(FILES_DIR, id)

    // Insert into DB with type 'bundle'
    getDb()
      .prepare("INSERT INTO files (id, name, alias, type) VALUES (?, ?, ?, 'bundle')")
      .run(id, name, alias)

    // Create git repo
    mkdirSync(repoPath, { recursive: true })
    await this.gitService.initRepo(repoPath)

    // Copy each file preserving relative structure
    for (const filePath of filePaths) {
      const relPath = relative(basePath, filePath).replace(/\\/g, '/')
      const destPath = join(repoPath, relPath)
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(filePath, destPath)
    }

    // Initial commit
    await this.gitService.addAllAndCommit(repoPath, 'Initial bundle import')

    log.info(`Created bundle: ${name} (${id}) with ${filePaths.length} files`)
    return this.getFile(id)!
  }

  async addFilesToBundle(
    fileId: string,
    filePaths: string[],
    basePath: string
  ): Promise<string[]> {
    const fileType = this.getFileType(fileId)
    if (fileType !== 'bundle') throw new Error('Can only add files to bundles')

    const repoPath = join(FILES_DIR, fileId)

    // Copy each file preserving relative structure
    const addedPaths: string[] = []
    for (const filePath of filePaths) {
      const relPath = relative(basePath, filePath).replace(/\\/g, '/')
      if (relPath.startsWith('..')) continue
      const destPath = join(repoPath, relPath)
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(filePath, destPath)
      addedPaths.push(relPath)
    }

    if (addedPaths.length === 0) throw new Error('No valid files to add')

    // Commit the new files
    await this.gitService.addAllAndCommit(repoPath, `Add ${addedPaths.length} file(s)`)

    // Update timestamp
    getDb()
      .prepare("UPDATE files SET updated_at = datetime('now') WHERE id = ?")
      .run(fileId)

    log.info(`Added ${addedPaths.length} files to bundle ${fileId}`)
    return addedPaths
  }

  async removeFilesFromBundle(
    fileId: string,
    filesToRemove: string[],
    deleteFromDisk: boolean = false
  ): Promise<string[]> {
    const fileType = this.getFileType(fileId)
    if (fileType !== 'bundle') throw new Error('Can only remove files from bundles')

    const repoPath = join(FILES_DIR, fileId)

    // Check we're not removing ALL files
    const currentFiles = await this.gitService.listFiles(repoPath)
    const remaining = currentFiles.filter((f) => !filesToRemove.includes(f))
    if (remaining.length === 0) throw new Error('Cannot remove all files from bundle')

    // Delete the files from internal repo
    const removed: string[] = []
    for (const relPath of filesToRemove) {
      const fullPath = join(repoPath, relPath)
      if (existsSync(fullPath)) {
        rmSync(fullPath)
        removed.push(relPath)
      }
    }

    if (removed.length === 0) throw new Error('No files found to remove')

    // Commit the removal
    await this.gitService.addAllAndCommit(repoPath, `Remove ${removed.length} file(s)`)

    // Optionally delete from ALL active deployments
    if (deleteFromDisk) {
      const deployments = getDb()
        .prepare("SELECT repo_path, file_relative_path FROM deployments WHERE file_id = ? AND is_active = 1")
        .all(fileId) as Array<{ repo_path: string; file_relative_path: string }>

      for (const dep of deployments) {
        const deployBase = join(dep.repo_path, dep.file_relative_path)
        for (const relPath of removed) {
          const deployedFile = join(deployBase, relPath)
          if (existsSync(deployedFile)) {
            rmSync(deployedFile)
          }
        }
      }
    }

    // Update timestamp
    getDb()
      .prepare("UPDATE files SET updated_at = datetime('now') WHERE id = ?")
      .run(fileId)

    log.info(`Removed ${removed.length} files from bundle ${fileId}${deleteFromDisk ? ' and all deployments' : ''}`)
    return removed
  }

  removeFileFromDeployment(
    deploymentId: string,
    filesToRemove: string[]
  ): string[] {
    const dep = getDb()
      .prepare('SELECT repo_path, file_relative_path FROM deployments WHERE id = ?')
      .get(deploymentId) as { repo_path: string; file_relative_path: string } | undefined
    if (!dep) throw new Error('Deployment not found')

    const deployBase = join(dep.repo_path, dep.file_relative_path)
    const removed: string[] = []

    for (const relPath of filesToRemove) {
      const deployedFile = join(deployBase, relPath)
      if (existsSync(deployedFile)) {
        rmSync(deployedFile)
        removed.push(relPath)
      }
    }

    if (removed.length === 0) throw new Error('No files found to remove')

    log.info(`Removed ${removed.length} files from deployment ${deploymentId}`)
    return removed
  }

  async listBundleEntries(fileId: string): Promise<string[]> {
    const repoPath = join(FILES_DIR, fileId)
    return this.gitService.listFiles(repoPath)
  }

  getFileType(fileId: string): string {
    const row = getDb()
      .prepare('SELECT type FROM files WHERE id = ?')
      .get(fileId) as { type: string } | undefined
    return row?.type ?? 'file'
  }

  getInternalRepoPath(fileId: string): string {
    return join(FILES_DIR, fileId)
  }

  async createFromCommit(
    name: string,
    alias: string,
    sourceDeploymentId: string,
    commitHash: string,
    selectedFiles: string[]
  ): Promise<ManagedFileRow> {
    // Resolve source internal repo from deployment
    const deployment = getDb()
      .prepare('SELECT file_id FROM deployments WHERE id = ?')
      .get(sourceDeploymentId) as { file_id: string } | undefined
    if (!deployment) throw new Error('Source deployment not found')

    const sourceRepoPath = join(FILES_DIR, deployment.file_id)
    const isBundle = selectedFiles.length > 1
    const id = uuidv4()
    const repoPath = join(FILES_DIR, id)

    // Insert into DB
    if (isBundle) {
      getDb()
        .prepare("INSERT INTO files (id, name, alias, type) VALUES (?, ?, ?, 'bundle')")
        .run(id, name, alias)
    } else {
      getDb()
        .prepare('INSERT INTO files (id, name, alias) VALUES (?, ?, ?)')
        .run(id, name, alias)
    }

    // Create git repo
    mkdirSync(repoPath, { recursive: true })
    await this.gitService.initRepo(repoPath)

    // Read files from source commit and write to new repo
    if (isBundle) {
      for (const relPath of selectedFiles) {
        const content = await this.gitService.getFileAtCommit(sourceRepoPath, commitHash, relPath)
        const destPath = join(repoPath, relPath)
        mkdirSync(dirname(destPath), { recursive: true })
        writeFileSync(destPath, content, 'utf-8')
      }
      await this.gitService.addAllAndCommit(repoPath, 'Initial bundle from commit')
    } else {
      const content = await this.gitService.getFileAtCommit(
        sourceRepoPath,
        commitHash,
        selectedFiles[0]
      )
      writeFileSync(join(repoPath, 'content'), content, 'utf-8')
      await this.gitService.addAndCommit(repoPath, 'content', 'Initial file from commit')
    }

    log.info(
      `Created ${isBundle ? 'bundle' : 'file'} from commit ${commitHash.substring(0, 7)}: ${name} (${id})`
    )
    return this.getFile(id)!
  }

  // --- Tag methods ---

  listTags(): TagRow[] {
    return getDb()
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(ft.file_id) as fileCount
         FROM tags t
         LEFT JOIN file_tags ft ON ft.tag_id = t.id
         GROUP BY t.id
         ORDER BY t.name`
      )
      .all() as TagRow[]
  }

  createTag(name: string, color: string): TagRow {
    const id = uuidv4()
    getDb()
      .prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
      .run(id, name, color)
    log.info(`Created tag: ${name} (${id})`)
    return { id, name, color }
  }

  deleteTag(id: string): void {
    getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
    log.info(`Deleted tag ${id}`)
  }

  getFileTags(fileId: string): TagRow[] {
    return getDb()
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
         INNER JOIN file_tags ft ON ft.tag_id = t.id
         WHERE ft.file_id = ?`
      )
      .all(fileId) as TagRow[]
  }

  setFileTags(fileId: string, tagIds: string[]): void {
    const db = getDb()
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(fileId)
      const insert = db.prepare('INSERT INTO file_tags (file_id, tag_id) VALUES (?, ?)')
      for (const tagId of tagIds) {
        insert.run(fileId, tagId)
      }
    })
    transaction()
    log.info(`Set ${tagIds.length} tags for file ${fileId}`)
  }
}
