import { ipcMain } from 'electron'
import { CommitService } from '../services/commit-service'

export function registerCommitHandlers(commitService: CommitService): void {
  ipcMain.handle('commits:list', async (_, deploymentId: string) => {
    try {
      return { success: true, data: await commitService.listCommits(deploymentId) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'commits:create',
    async (_, deploymentId: string, message: string, tag?: string) => {
      try {
        const data = await commitService.createCommit(deploymentId, message, tag)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'commits:diff',
    async (_, deploymentId: string, hash1: string, hash2?: string) => {
      try {
        const data = await commitService.getDiff(deploymentId, hash1, hash2)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('commits:diff-working', async (_, deploymentId: string) => {
    try {
      const data = await commitService.getDiffWorking(deploymentId)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'commits:checkout',
    async (_, deploymentId: string, commitHash: string) => {
      try {
        await commitService.checkoutToCommit(deploymentId, commitHash)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('commits:files-current', async (_, deploymentId: string) => {
    try {
      const data = await commitService.getCurrentFiles(deploymentId)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'commits:file-at',
    async (_, deploymentId: string, commitHash: string) => {
      try {
        const data = await commitService.getFileAtCommit(deploymentId, commitHash)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'commits:files-at',
    async (_, deploymentId: string, commitHash: string) => {
      try {
        const data = await commitService.getFilesAtCommit(deploymentId, commitHash)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
