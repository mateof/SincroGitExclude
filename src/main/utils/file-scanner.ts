import { readdirSync } from 'fs'
import { join, relative } from 'path'

/** Directories that should never be synced regardless of user patterns */
const BUILTIN_IGNORED_DIRS = new Set(['.git', '.svn', '.hg'])

/**
 * Recursively scan a directory and return all file paths relative to basePath,
 * filtering out any paths matching the provided ignore patterns.
 * Always ignores .git, .svn, .hg directories.
 */
export function scanDirectory(basePath: string, ignorePatterns: string[] = []): string[] {
  const result: string[] = []

  function walk(dir: string): void {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      // Always skip VCS directories
      if (entry.isDirectory() && BUILTIN_IGNORED_DIRS.has(entry.name)) continue

      const fullPath = join(dir, entry.name)
      const relPath = relative(basePath, fullPath).replace(/\\/g, '/')

      if (matchesAnyPattern(relPath, ignorePatterns)) continue

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        result.push(relPath)
      }
    }
  }

  walk(basePath)
  return result
}

/**
 * Check if a relative path matches any of the given ignore patterns.
 */
export function matchesAnyPattern(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchesPattern(relPath, pattern)) return true
  }
  return false
}

/**
 * Match a relative path against a single ignore pattern.
 * Supported patterns:
 *   dist/        → directory prefix (matches 'dist' and 'dist/...')
 *   *.log        → glob with * (matches against full path and filename)
 *   **​/build/   → recursive directory pattern
 *   node_modules → exact or prefix match
 *   #comment     → ignored (comment lines)
 */
function matchesPattern(relPath: string, pattern: string): boolean {
  const p = pattern.trim()
  if (!p || p.startsWith('#')) return false

  // Directory pattern: 'dist/' matches 'dist' dir and all children
  if (p.endsWith('/')) {
    const dir = p.slice(0, -1)
    // Also match if any path segment equals dir (e.g., 'src/dist/file' matches 'dist/')
    if (dir.includes('/') || dir.includes('*')) {
      // Complex dir pattern — use glob matching on path prefix
      return globMatch(relPath, dir) || globMatch(relPath, p + '**')
    }
    const segments = relPath.split('/')
    return segments.some((seg, i) => {
      if (seg === dir) {
        // Check it's a directory component (not the last part, or the relPath is exactly the dir)
        return i < segments.length - 1 || relPath === dir
      }
      return false
    })
  }

  // Glob pattern with *
  if (p.includes('*')) {
    const fileName = relPath.split('/').pop() || ''
    return globMatch(relPath, p) || globMatch(fileName, p)
  }

  // Exact match or prefix match (treat as directory-like)
  return relPath === p || relPath.startsWith(p + '/')
}

/**
 * Simple glob matching supporting * and **
 */
function globMatch(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*')

  return new RegExp('^' + regexStr + '$').test(str)
}
