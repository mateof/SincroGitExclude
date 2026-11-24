import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const SPACE_META_DIR = '.sge-kb'
export const SPACE_META_FILE = 'space.json'

export interface SpaceMeta {
  id: string
  name: string
  format: 1
}

export function readSpaceMeta(root: string): SpaceMeta | null {
  const file = join(root, SPACE_META_DIR, SPACE_META_FILE)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SpaceMeta>
    if (typeof parsed.id !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(parsed.id)) return null
    return { id: parsed.id, name: typeof parsed.name === 'string' ? parsed.name : parsed.id, format: 1 }
  } catch {
    return null
  }
}

export function ensureSpaceMeta(root: string, name: string): SpaceMeta {
  const existing = readSpaceMeta(root)
  if (existing) return existing
  const meta: SpaceMeta = { id: randomUUID(), name, format: 1 }
  mkdirSync(join(root, SPACE_META_DIR), { recursive: true })
  writeFileSync(join(root, SPACE_META_DIR, SPACE_META_FILE), JSON.stringify(meta, null, 2) + '\n', 'utf-8')
  return meta
}

export function renameSpaceMeta(root: string, name: string): void {
  const existing = readSpaceMeta(root)
  if (!existing) return
  writeFileSync(
    join(root, SPACE_META_DIR, SPACE_META_FILE),
    JSON.stringify({ ...existing, name }, null, 2) + '\n',
    'utf-8'
  )
}
