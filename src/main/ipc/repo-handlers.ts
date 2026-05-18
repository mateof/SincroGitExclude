import { ipcMain } from 'electron'
import { existsSync, statSync, realpathSync } from 'fs'
import { basename, isAbsolute, join, relative } from 'path'
import { RepoService } from '../services/repo-service'
import { GitExcludeService } from '../git/git-exclude'
import { getDb } from '../database/connection'

interface ValidationResult {
  isOutsideRepo: boolean
  exists: boolean
  isDirectory: boolean
  isGlob: boolean
  caseMismatch: boolean
  actualName: string | null
  fsCaseInsensitive: boolean
}

const caseInsensitiveCache = new Map<string, boolean>()

function isFsCaseInsensitive(repoPath: string): boolean {
  const cached = caseInsensitiveCache.get(repoPath)
  if (cached !== undefined) return cached

  let result = false
  try {
    const gitDir = join(repoPath, '.git')
    const altCase = join(repoPath, '.GIT')
    // If both casings resolve to existing dirs, FS is case-insensitive
    if (existsSync(gitDir) && existsSync(altCase)) {
      result = true
    }
  } catch {
    // fallthrough
  }
  if (!result) {
    // Fallback heuristic by platform (macOS APFS and Windows NTFS default to case-insensitive)
    if (process.platform === 'darwin' || process.platform === 'win32') {
      result = true
    }
  }
  caseInsensitiveCache.set(repoPath, result)
  return result
}

function validatePattern(repoPath: string, rawPattern: string): ValidationResult {
  const fsCaseInsensitive = isFsCaseInsensitive(repoPath)
  const empty: ValidationResult = {
    isOutsideRepo: false,
    exists: false,
    isDirectory: false,
    isGlob: false,
    caseMismatch: false,
    actualName: null,
    fsCaseInsensitive
  }

  let pattern = rawPattern.trim()
  if (!pattern) return empty
  if (pattern.startsWith('!')) pattern = pattern.slice(1)
  if (pattern.startsWith('#')) {
    return { ...empty, isGlob: true }
  }
  if (/[*?\[]/.test(pattern)) {
    return { ...empty, isGlob: true }
  }
  if (isAbsolute(pattern)) {
    return { ...empty, isOutsideRepo: true }
  }

  let rel = pattern.replace(/^\/+/, '')
  if (rel.endsWith('/')) rel = rel.slice(0, -1)
  if (!rel) return empty

  const absPath = join(repoPath, rel)
  const relCheck = relative(repoPath, absPath)
  if (relCheck.startsWith('..')) {
    return { ...empty, isOutsideRepo: true }
  }
  if (!existsSync(absPath)) {
    return empty
  }

  try {
    const stat = statSync(absPath)
    let caseMismatch = false
    let actualName: string | null = null
    try {
      const realPath = realpathSync.native(absPath)
      if (realPath !== absPath) {
        caseMismatch = true
        // Find the segment that differs to give a useful display name
        const realRel = relative(repoPath, realPath).replace(/\\/g, '/')
        actualName = realRel || basename(realPath)
      }
    } catch {
      // ignore
    }
    return {
      isOutsideRepo: false,
      exists: true,
      isDirectory: stat.isDirectory(),
      isGlob: false,
      caseMismatch,
      actualName,
      fsCaseInsensitive
    }
  } catch {
    return empty
  }
}

interface LinkedDeployment {
  id: string
  fileId: string
  fileName: string
  fileAlias: string
  fileRelativePath: string
}

export function registerRepoHandlers(
  repoService: RepoService,
  excludeService: GitExcludeService
): void {
  ipcMain.handle('repos:list', async () => {
    try {
      return { success: true, data: repoService.listRepos() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('repos:get', async (_, id: string) => {
    try {
      const data = await repoService.getRepo(id)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('repos:add', async (_, path: string, description?: string, tagIds?: string[]) => {
    try {
      const repo = repoService.addRepo(path, description)
      if (tagIds && tagIds.length > 0) {
        repoService.setRepoTags(repo.id, tagIds)
      }
      return { success: true, data: repo }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'repos:update-description',
    async (_, id: string, description: string | null) => {
      try {
        return { success: true, data: repoService.updateDescription(id, description) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('repos:remove', async (_, id: string) => {
    try {
      repoService.removeRepo(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('repos:set-tags', async (_, repoId: string, tagIds: string[]) => {
    try {
      repoService.setRepoTags(repoId, tagIds)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('repos:list-deployments', async (_, repoId: string) => {
    try {
      return { success: true, data: repoService.listRepoDeployments(repoId) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('repos:list-excludes', async (_, repoId: string) => {
    try {
      const repo = repoService.getRow(repoId)
      if (!repo) throw new Error('Repo not found')

      const rawEntries = excludeService.listEntries(repo.path)

      // Build lookup of all deployments in this repo path so we can resolve linked deployments
      const deps = getDb()
        .prepare(
          `SELECT d.id, d.file_id, d.file_relative_path, f.name AS file_name, f.alias AS file_alias
           FROM deployments d
           INNER JOIN files f ON f.id = d.file_id
           WHERE d.repo_path = ?`
        )
        .all(repo.path) as Array<{
        id: string
        file_id: string
        file_relative_path: string
        file_name: string
        file_alias: string
      }>
      const byId = new Map(deps.map((d) => [d.id, d]))

      const enriched = rawEntries.map((e) => {
        let linkedDeployment: LinkedDeployment | null = null
        if (e.managedByApp && e.deploymentId && e.deploymentId !== 'manual') {
          const d = byId.get(e.deploymentId)
          if (d) {
            linkedDeployment = {
              id: d.id,
              fileId: d.file_id,
              fileName: d.file_name,
              fileAlias: d.file_alias,
              fileRelativePath: d.file_relative_path
            }
          }
        }
        return { ...e, linkedDeployment }
      })

      return { success: true, data: enriched }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('repos:add-exclude', async (_, repoId: string, pattern: string) => {
    try {
      const repo = repoService.getRow(repoId)
      if (!repo) throw new Error('Repo not found')
      await excludeService.addManualExclusion(repo.path, pattern)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'repos:remove-exclude',
    async (_, repoId: string, lineNumber: number, expectedPattern: string) => {
      try {
        const repo = repoService.getRow(repoId)
        if (!repo) throw new Error('Repo not found')
        await excludeService.removeExclusionByLine(repo.path, lineNumber, expectedPattern)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'repos:validate-pattern',
    async (_, repoId: string, pattern: string) => {
      try {
        const repo = repoService.getRow(repoId)
        if (!repo) throw new Error('Repo not found')
        return { success: true, data: validatePattern(repo.path, pattern) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
