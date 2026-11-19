import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_DATA_DIR } from './app-paths'

export const PREFERENCES_PATH = join(DEFAULT_DATA_DIR, 'preferences.json')

export interface Preferences {
  autoExclude: boolean
  snapshotsEnabled: boolean
  verboseLogs: boolean
}

interface StoredPreferences extends Preferences {
  migrated: boolean
}

const DEFAULTS: StoredPreferences = {
  autoExclude: true,
  snapshotsEnabled: true,
  verboseLogs: false,
  migrated: false
}

let cached: StoredPreferences | null = null

function load(): StoredPreferences {
  if (cached) return cached
  let parsed: Partial<StoredPreferences> = {}
  if (existsSync(PREFERENCES_PATH)) {
    try {
      parsed = JSON.parse(readFileSync(PREFERENCES_PATH, 'utf-8')) as Partial<StoredPreferences>
    } catch {
      parsed = {}
    }
  }
  cached = {
    autoExclude: typeof parsed.autoExclude === 'boolean' ? parsed.autoExclude : DEFAULTS.autoExclude,
    snapshotsEnabled:
      typeof parsed.snapshotsEnabled === 'boolean' ? parsed.snapshotsEnabled : DEFAULTS.snapshotsEnabled,
    verboseLogs: typeof parsed.verboseLogs === 'boolean' ? parsed.verboseLogs : DEFAULTS.verboseLogs,
    migrated: parsed.migrated === true
  }
  return cached
}

function save(next: StoredPreferences): void {
  cached = next
  writeFileSync(PREFERENCES_PATH, JSON.stringify(next, null, 2), 'utf-8')
}

export function readPreferences(): { preferences: Preferences; migrated: boolean } {
  const { migrated, ...preferences } = load()
  return { preferences, migrated }
}

export function sanitizePreferences(patch: unknown): Partial<Preferences> {
  const source = (patch ?? {}) as Record<string, unknown>
  const clean: Partial<Preferences> = {}
  for (const key of ['autoExclude', 'snapshotsEnabled', 'verboseLogs'] as const) {
    if (typeof source[key] === 'boolean') clean[key] = source[key] as boolean
  }
  return clean
}

export function writePreferences(patch: Partial<Preferences>, markMigrated = true): Preferences {
  const next = { ...load(), ...sanitizePreferences(patch) }
  if (markMigrated) next.migrated = true
  save(next)
  return readPreferences().preferences
}
