import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SPACE_META_DIR } from '../space-meta'

export interface RegistryEntry {
  remote: string
  note: string
  name: string
}

const FILE = 'repos.json'

export function normalizeRemoteUrl(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null
  let host = ''
  let path = ''
  const scp = raw.match(/^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      host = parsed.hostname
      path = parsed.pathname
    } catch {
      return null
    }
  } else if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    return null
  }
  const cleanPath = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  if (!host || !cleanPath) return null
  return `${host.toLowerCase()}/${cleanPath.toLowerCase()}`
}

export function readRegistry(spaceRoot: string): RegistryEntry[] {
  const file = join(spaceRoot, SPACE_META_DIR, FILE)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { repos?: unknown }
    if (!Array.isArray(parsed.repos)) return []
    return parsed.repos.filter(
      (r): r is RegistryEntry =>
        !!r && typeof r === 'object' && typeof (r as RegistryEntry).remote === 'string' && typeof (r as RegistryEntry).note === 'string'
    )
  } catch {
    return []
  }
}

function writeRegistry(spaceRoot: string, entries: RegistryEntry[]): void {
  mkdirSync(join(spaceRoot, SPACE_META_DIR), { recursive: true })
  const sorted = [...entries].sort((a, b) => a.remote.localeCompare(b.remote))
  writeFileSync(join(spaceRoot, SPACE_META_DIR, FILE), JSON.stringify({ repos: sorted }, null, 2) + '\n', 'utf-8')
}

export function upsertRegistry(spaceRoot: string, entry: RegistryEntry): void {
  const entries = readRegistry(spaceRoot).filter((e) => e.remote !== entry.remote)
  entries.push(entry)
  writeRegistry(spaceRoot, entries)
}

export function removeFromRegistry(spaceRoot: string, remote: string): void {
  const entries = readRegistry(spaceRoot)
  const next = entries.filter((e) => e.remote !== remote)
  if (next.length !== entries.length) writeRegistry(spaceRoot, next)
}
