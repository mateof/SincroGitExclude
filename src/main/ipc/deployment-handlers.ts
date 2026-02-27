import { ipcMain } from 'electron'
import { DeploymentService } from '../services/deployment-service'

export function registerDeploymentHandlers(
  deploymentService: DeploymentService
): void {
  ipcMain.handle('deployments:list', async (_, fileId: string) => {
    try {
      return { success: true, data: deploymentService.listDeployments(fileId) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:stats', async () => {
    try {
      const stats = deploymentService.getStats()
      const pending = await deploymentService.countPendingChanges()
      return {
        success: true,
        data: {
          ...stats,
          pendingChanges: pending.count,
          fileIdsWithChanges: pending.fileIds
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'deployments:create',
    async (
      _,
      fileId: string,
      repoPath: string,
      fileRelativePath: string,
      sourceBranch?: string,
      sourceCommit?: string,
      autoExclude: boolean = true
    ) => {
      try {
        const data = await deploymentService.createDeployment(
          fileId,
          repoPath,
          fileRelativePath,
          sourceBranch,
          sourceCommit,
          autoExclude
        )
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('deployments:deactivate', async (_, id: string) => {
    try {
      await deploymentService.deactivateDeployment(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:reactivate', async (_, id: string) => {
    try {
      await deploymentService.reactivateDeployment(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:delete', async (_, id: string, deleteFromDisk: boolean = false) => {
    try {
      await deploymentService.deleteDeployment(id, deleteFromDisk)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:sync', async (_, id: string) => {
    try {
      await deploymentService.syncDeployment(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:check-changes', async (_, id: string) => {
    try {
      const hasChanges = await deploymentService.checkForChanges(id)
      return { success: true, data: hasChanges }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:check-exclude', async (_, id: string) => {
    try {
      const isExcluded = await deploymentService.checkExcludeStatus(id)
      return { success: true, data: isExcluded }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:check-file-exists', (_, id: string) => {
    try {
      const exists = deploymentService.checkFileExists(id)
      return { success: true, data: exists }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('deployments:update-description', (_, id: string, description: string | null) => {
    try {
      const data = deploymentService.updateDescription(id, description)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
