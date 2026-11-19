import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hostname } from 'os'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import { DEFAULT_DATA_DIR } from '../app-paths'

export const SYNC_CONFIG_PATH = join(DEFAULT_DATA_DIR, 'sync.json')
export const SYNC_META_REPO = join(DEFAULT_DATA_DIR, 'sync-meta.git')

export interface SyncConfig {
  remoteUrl: string
  machineId: string
  machineName: string
  lastPushAt: string | null
  lastPullAt: string | null
}

let cached: SyncConfig | null = null

function defaults(): SyncConfig {
  return {
    remoteUrl: '',
    machineId: randomUUID(),
    machineName: hostname(),
    lastPushAt: null,
    lastPullAt: null
  }
}

export function readSyncConfig(): SyncConfig {
  if (cached) return cached
  const base = defaults()
  if (existsSync(SYNC_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(SYNC_CONFIG_PATH, 'utf-8')) as Partial<SyncConfig>
      cached = {
        remoteUrl: typeof parsed.remoteUrl === 'string' ? parsed.remoteUrl : base.remoteUrl,
        machineId: typeof parsed.machineId === 'string' && parsed.machineId ? parsed.machineId : base.machineId,
        machineName:
          typeof parsed.machineName === 'string' && parsed.machineName.trim()
            ? parsed.machineName
            : base.machineName,
        lastPushAt: typeof parsed.lastPushAt === 'string' ? parsed.lastPushAt : null,
        lastPullAt: typeof parsed.lastPullAt === 'string' ? parsed.lastPullAt : null
      }
      return cached
    } catch (error) {
      log.warn('Invalid sync.json, falling back to defaults:', error)
    }
  }
  cached = base
  writeFileSync(SYNC_CONFIG_PATH, JSON.stringify(cached, null, 2), 'utf-8')
  return cached
}

export function writeSyncConfig(patch: Partial<SyncConfig>): SyncConfig {
  const next = { ...readSyncConfig(), ...patch }
  cached = next
  writeFileSync(SYNC_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function validateRemoteUrl(value: unknown): string | null {
  if (typeof value !== 'string') return 'Invalid remote URL'
  const url = value.trim()
  if (!url) return null
  if (/[\u0000-\u001f\u007f]/.test(url)) return 'The remote URL cannot contain control characters'
  if (url.startsWith('-')) return 'Invalid remote URL'
  return null
}
