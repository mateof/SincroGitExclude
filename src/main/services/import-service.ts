import { join } from 'path'
import { existsSync, copyFileSync, cpSync, renameSync, readFileSync, rmSync } from 'fs'
import extractZip from 'extract-zip'
import { FILES_DIR, DB_PATH, EXPORT_TEMP_DIR } from '../app-paths'
import { getDb, closeDb } from '../database/connection'
import { runMigrations } from '../database/migrations'
import { GitExcludeService } from '../git/git-exclude'
import { WatcherService } from './watcher-service'
import Database from 'better-sqlite3'
import log from 'electron-log'

export interface ImportValidationFile {
  id: string
  name: string
  alias: string
  deployments: Array<{
    id: string
    repoPath: string
    fileRelativePath: string
    repoExists: boolean
    fileExists: boolean
  }>
}

export interface ImportValidationResult {
  metadata: {
    version: string
    exportDate: string
    fileCount: number
  }
  files: ImportValidationFile[]
}

export class ImportService {
  constructor(
    private excludeService: GitExcludeService,
    private watcherService: WatcherService
  ) {}

  async validateImport(archivePath: string): Promise<ImportValidationResult> {
    const extractDir = join(EXPORT_TEMP_DIR, 'import-validate')

    // Clean previous validation
    if (existsSync(extractDir)) {
      rmSync(extractDir, { recursive: true, force: true })
    }

    await extractZip(archivePath, { dir: extractDir })

    // Read metadata
    const metadataPath = join(extractDir, 'metadata.json')
    if (!existsSync(metadataPath)) {
      throw new Error('Invalid archive: metadata.json not found')
    }
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))

    // Open the embedded database
    const importDbPath = join(extractDir, 'sincrogitexclude.db')
    if (!existsSync(importDbPath)) {
      throw new Error('Invalid archive: database not found')
    }

    const importDb = new Database(importDbPath, { readonly: true })

    const files = importDb.prepare('SELECT * FROM files').all() as Array<{
      id: string
      name: string
      alias: string
    }>

    const result: ImportValidationFile[] = files.map((file) => {
      const deployments = importDb
        .prepare('SELECT * FROM deployments WHERE file_id = ?')
        .all(file.id) as Array<{
        id: string
        repo_path: string
        file_relative_path: string
      }>

      return {
        id: file.id,
        name: file.name,
        alias: file.alias,
        deployments: deployments.map((d) => ({
          id: d.id,
          repoPath: d.repo_path,
          fileRelativePath: d.file_relative_path,
          repoExists: existsSync(join(d.repo_path, '.git')),
          fileExists: existsSync(join(d.repo_path, d.file_relative_path))
        }))
      }
    })

    importDb.close()

    // Clean up
    rmSync(extractDir, { recursive: true, force: true })

    return {
      metadata: {
        version: metadata.version,
        exportDate: metadata.exportDate,
        fileCount: metadata.fileCount
      },
      files: result
    }
  }

  async executeImport(archivePath: string): Promise<void> {
    const extractDir = join(EXPORT_TEMP_DIR, 'import-exec')

    // Clean previous import
    if (existsSync(extractDir)) {
      rmSync(extractDir, { recursive: true, force: true })
    }

    await extractZip(archivePath, { dir: extractDir })

    // Stop all watchers
    await this.watcherService.unwatchAll()

    // Close current DB
    closeDb()

    // Backup current DB
    if (existsSync(DB_PATH)) {
      renameSync(DB_PATH, DB_PATH + '.bak')
    }

    // Copy imported DB
    const importDbPath = join(extractDir, 'sincrogitexclude.db')
    copyFileSync(importDbPath, DB_PATH)

    // Copy imported file repos
    const importFilesDir = join(extractDir, 'files')
    if (existsSync(importFilesDir)) {
      cpSync(importFilesDir, FILES_DIR, { recursive: true, force: true })
    }

    // Reopen DB and run migrations
    const db = getDb()
    runMigrations(db)

    // Validate deployments
    const deployments = db
      .prepare('SELECT * FROM deployments')
      .all() as Array<{
      id: string
      repo_path: string
      file_relative_path: string
    }>

    for (const d of deployments) {
      const repoExists = existsSync(join(d.repo_path, '.git'))
      const fullPath = join(d.repo_path, d.file_relative_path)

      if (repoExists) {
        db.prepare('UPDATE deployments SET is_active = 1 WHERE id = ?').run(d.id)

        // Re-add to git exclude
        await this.excludeService.addExclusion(d.repo_path, d.file_relative_path, d.id)

        // Start watching if file exists
        if (existsSync(fullPath)) {
          await this.watcherService.watchDeployment(d.id, fullPath)
        }
      } else {
        db.prepare('UPDATE deployments SET is_active = 0 WHERE id = ?').run(d.id)
      }
    }

    // Clean up
    rmSync(extractDir, { recursive: true, force: true })

    log.info('Import completed successfully')
  }
}
