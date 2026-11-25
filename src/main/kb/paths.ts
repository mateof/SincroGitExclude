import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { realpathSync } from 'fs'

export class PathOutsideSpaceError extends Error {
  constructor(path: string) {
    super(`The path is outside the space: ${path}`)
    this.name = 'PathOutsideSpaceError'
  }
}

export function normalizeRel(path: string): string {
  const unified = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
  const parts: string[] = []
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new PathOutsideSpaceError(path)
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function resolveInSpace(root: string, relPath: string): string {
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) throw new PathOutsideSpaceError(relPath)
  const clean = normalizeRel(relPath)
  const full = resolve(root, ...clean.split('/'))
  if (!isInside(resolve(root), full)) throw new PathOutsideSpaceError(relPath)
  let realRoot: string
  try {
    realRoot = realpathSync.native(root)
  } catch {
    return full
  }
  let probe = full
  const missing: string[] = []
  for (;;) {
    try {
      const real = join(realpathSync.native(probe), ...missing.reverse())
      if (!isInside(realRoot, real)) throw new PathOutsideSpaceError(relPath)
      return full
    } catch (error) {
      if (error instanceof PathOutsideSpaceError) throw error
      const parent = dirname(probe)
      if (parent === probe) return full
      missing.push(basename(probe))
      probe = parent
    }
  }
}

export function toRel(root: string, full: string): string {
  return relative(root, full).split(sep).join('/')
}

export function isHiddenSegment(rel: string): boolean {
  return rel.split('/').some((part) => part.startsWith('.') || part === 'node_modules')
}
