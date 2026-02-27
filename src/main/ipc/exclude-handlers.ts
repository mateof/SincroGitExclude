import { ipcMain } from 'electron'
import { join } from 'path'
import { GitExcludeService } from '../git/git-exclude'
import { GitService } from '../git/git-service'
import { getDb } from '../database/connection'
import { FILES_DIR } from '../app-paths'

interface DeploymentRow {
  id: string
  file_id: string
  repo_path: string
  file_relative_path: string
}

function getFileType(fileId: string): string {
  const row = getDb()
    .prepare('SELECT type FROM files WHERE id = ?')
    .get(fileId) as { type: string } | undefined
  return row?.type ?? 'file'
}

function getBundleExcludePaths(bundleFiles: string[], fileRelativePath: string): string[] {
  const base = fileRelativePath.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return bundleFiles.map((f) => (base && base !== '.' ? `${base}/${f}` : f))
}

export function registerExcludeHandlers(
  excludeService: GitExcludeService,
  gitService: GitService
): void {
  ipcMain.handle('exclude:check', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      if (fileType === 'bundle') {
        const internalRepoPath = join(FILES_DIR, deployment.file_id)
        const bundleFiles = await gitService.listFiles(internalRepoPath)
        const excludePaths = getBundleExcludePaths(bundleFiles, deployment.file_relative_path)

        for (const p of excludePaths) {
          const excluded = await excludeService.isExcluded(deployment.repo_path, p)
          if (!excluded) return { success: true, data: false }
        }
        return { success: true, data: excludePaths.length > 0 }
      }

      const isExcluded = await excludeService.isExcluded(
        deployment.repo_path,
        deployment.file_relative_path
      )
      return { success: true, data: isExcluded }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('exclude:add', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      if (fileType === 'bundle') {
        const internalRepoPath = join(FILES_DIR, deployment.file_id)
        const bundleFiles = await gitService.listFiles(internalRepoPath)
        const excludePaths = getBundleExcludePaths(bundleFiles, deployment.file_relative_path)
        await excludeService.addExclusions(deployment.repo_path, excludePaths, deploymentId)
      } else {
        await excludeService.addExclusion(
          deployment.repo_path,
          deployment.file_relative_path,
          deploymentId
        )
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('exclude:check-global', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      if (fileType === 'bundle') {
        const internalRepoPath = join(FILES_DIR, deployment.file_id)
        const bundleFiles = await gitService.listFiles(internalRepoPath)
        const excludePaths = getBundleExcludePaths(bundleFiles, deployment.file_relative_path)

        // For bundles: true if ALL files are globally excluded
        for (const p of excludePaths) {
          const excluded = await excludeService.isGloballyExcluded(p)
          if (!excluded) return { success: true, data: false }
        }
        return { success: true, data: excludePaths.length > 0 }
      }

      const isGlobal = await excludeService.isGloballyExcluded(
        deployment.file_relative_path
      )
      return { success: true, data: isGlobal }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // --- .gitignore handlers ---

  ipcMain.handle('gitignore:check', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      // For bundles, check if the base directory is in .gitignore
      const pathToCheck = fileType === 'bundle'
        ? deployment.file_relative_path.replace(/[\\/]+$/, '') + '/'
        : deployment.file_relative_path

      const isIgnored = excludeService.isInGitIgnore(deployment.repo_path, pathToCheck)
      return { success: true, data: isIgnored }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('gitignore:add', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      // For bundles, add directory with trailing slash
      const pathToAdd = fileType === 'bundle'
        ? deployment.file_relative_path.replace(/[\\/]+$/, '') + '/'
        : deployment.file_relative_path

      excludeService.addToGitIgnore(deployment.repo_path, pathToAdd, deploymentId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('gitignore:remove', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      const pathToRemove = fileType === 'bundle'
        ? deployment.file_relative_path.replace(/[\\/]+$/, '') + '/'
        : deployment.file_relative_path

      excludeService.removeFromGitIgnore(deployment.repo_path, pathToRemove)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('exclude:remove', async (_, deploymentId: string) => {
    try {
      const deployment = getDb()
        .prepare('SELECT * FROM deployments WHERE id = ?')
        .get(deploymentId) as DeploymentRow | undefined

      if (!deployment) return { success: false, error: 'Deployment not found' }

      const fileType = getFileType(deployment.file_id)
      if (fileType === 'bundle') {
        const internalRepoPath = join(FILES_DIR, deployment.file_id)
        const bundleFiles = await gitService.listFiles(internalRepoPath)
        const excludePaths = getBundleExcludePaths(bundleFiles, deployment.file_relative_path)
        await excludeService.removeExclusions(deployment.repo_path, excludePaths, deploymentId)
      } else {
        await excludeService.removeExclusion(
          deployment.repo_path,
          deployment.file_relative_path,
          deploymentId
        )
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
