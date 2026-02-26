import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, readFileSync } from 'fs'

export const DEFAULT_DATA_DIR = app.getPath('userData')
export const CONFIG_FILE_PATH = join(DEFAULT_DATA_DIR, 'data-path.json')

function resolveDataDir(): string {
  if (existsSync(CONFIG_FILE_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_FILE_PATH, 'utf-8'))
      if (config.dataDir && existsSync(config.dataDir)) {
        return config.dataDir
      }
    } catch {
      // Invalid config — use default
    }
  }
  return DEFAULT_DATA_DIR
}

export const APP_DATA_DIR = resolveDataDir()
export const FILES_DIR = join(APP_DATA_DIR, 'files')
export const DB_PATH = join(APP_DATA_DIR, 'sincrogitexclude.db')
export const EXPORT_TEMP_DIR = join(APP_DATA_DIR, 'temp')

export function ensureDirectories(): void {
  mkdirSync(FILES_DIR, { recursive: true })
  mkdirSync(EXPORT_TEMP_DIR, { recursive: true })
}
