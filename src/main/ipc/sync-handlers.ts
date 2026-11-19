import { ipcMain } from 'electron'
import { describeError } from '../utils/errors'
import type { SyncService } from '../sync/sync-service'

export function registerSyncHandlers(syncService: SyncService): void {
  ipcMain.handle('sync:get-config', async () => {
    try {
      return { success: true, data: syncService.getConfig() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle(
    'sync:set-config',
    async (_, patch: { remoteUrl?: string; machineName?: string }) => {
      try {
        return { success: true, data: syncService.setConfig(patch ?? {}) }
      } catch (error) {
        return { success: false, error: describeError(error) }
      }
    }
  )

  ipcMain.handle('sync:test', async (_, url?: string) => {
    try {
      return { success: true, data: await syncService.testConnection(url) }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('sync:push', async () => {
    try {
      return { success: true, data: await syncService.push() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('sync:pull', async () => {
    try {
      return { success: true, data: await syncService.pull() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('sync:remote-sources', async (_, fileId: string) => {
    try {
      return { success: true, data: await syncService.remoteSources(fileId) }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('sync:remote-commits', async (_, fileId: string, ref: string) => {
    try {
      return { success: true, data: await syncService.remoteCommits(fileId, ref) }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })
}
