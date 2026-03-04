import { ipcMain } from 'electron'
import type { SnapshotService } from '../services/snapshot-service'

export function registerSnapshotHandlers(snapshotService: SnapshotService): void {
  ipcMain.handle(
    'snapshots:between-commits',
    async (_, deploymentId: string, commitHash: string | null, nextCommitHash?: string | null) => {
      try {
        const data = snapshotService.getSnapshotsBetweenCommits(
          deploymentId,
          commitHash,
          nextCommitHash
        )
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'snapshots:count-for-commit',
    async (_, deploymentId: string, commitHash: string | null) => {
      try {
        const data = snapshotService.getSnapshotCountForCommit(deploymentId, commitHash)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('snapshots:full-state', async (_, snapshotId: string) => {
    try {
      const data = await snapshotService.getFullStateAtSnapshot(snapshotId)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('snapshots:files', async (_, snapshotId: string) => {
    try {
      const data = snapshotService.getSnapshotFiles(snapshotId)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('snapshots:apply', async (_, snapshotId: string) => {
    try {
      await snapshotService.applySnapshot(snapshotId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'snapshots:deploy',
    async (_, snapshotId: string, destFolder: string) => {
      try {
        const data = await snapshotService.deploySnapshot(snapshotId, destFolder)
        return { success: true, data }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('snapshots:set-enabled', async (_, enabled: boolean) => {
    try {
      snapshotService.setEnabled(enabled)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
