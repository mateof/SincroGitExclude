import archiver from 'archiver'
import { createWriteStream } from 'fs'
import { app } from 'electron'
import { FILES_DIR, DB_PATH } from '../app-paths'
import { getDb, closeDb } from '../database/connection'
import log from 'electron-log'

export class ExportService {
  async exportAll(outputPath: string): Promise<void> {
    const db = getDb()

    const fileCount = (
      db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }
    ).c
    const deploymentCount = (
      db.prepare('SELECT COUNT(*) as c FROM deployments').get() as { c: number }
    ).c

    const metadata = {
      version: app.getVersion(),
      exportDate: new Date().toISOString(),
      platform: process.platform,
      fileCount,
      deploymentCount
    }

    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        log.info(`Export complete: ${archive.pointer()} bytes written to ${outputPath}`)
        resolve()
      })

      archive.on('error', (err) => {
        log.error('Export error:', err)
        reject(err)
      })

      archive.pipe(output)

      // Add metadata
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' })

      // Add database (close and reopen to ensure consistency)
      closeDb()
      archive.file(DB_PATH, { name: 'sincrogitexclude.db' })

      // Add all file repos
      archive.directory(FILES_DIR, 'files')

      archive.finalize().then(() => {
        // Reopen DB
        getDb()
      })
    })
  }
}
