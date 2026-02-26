import { ipcMain } from 'electron'
import { FileService } from '../services/file-service'

export function registerFileHandlers(fileService: FileService): void {
  ipcMain.handle('files:list', async () => {
    try {
      return { success: true, data: fileService.listFiles() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('files:get', async (_, id: string) => {
    try {
      return { success: true, data: fileService.getFile(id) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('files:create', async (_, name: string, alias: string, tagIds?: string[]) => {
    try {
      const file = await fileService.createFile(name, alias)
      if (tagIds && tagIds.length > 0) {
        fileService.setFileTags(file.id, tagIds)
        file.tags = fileService.getFileTags(file.id)
      }
      return { success: true, data: file }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'files:update',
    async (_, id: string, data: { name?: string; alias?: string; useAutoIcon?: boolean }) => {
      try {
        return { success: true, data: fileService.updateFile(id, data) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('files:delete', async (_, id: string) => {
    try {
      await fileService.deleteFile(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // --- Tag handlers ---

  ipcMain.handle('tags:list', async () => {
    try {
      return { success: true, data: fileService.listTags() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('tags:create', async (_, name: string, color: string) => {
    try {
      return { success: true, data: fileService.createTag(name, color) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('tags:delete', async (_, id: string) => {
    try {
      fileService.deleteTag(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('files:set-tags', async (_, fileId: string, tagIds: string[]) => {
    try {
      fileService.setFileTags(fileId, tagIds)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // --- Bundle handlers ---

  ipcMain.handle(
    'files:create-bundle',
    async (_, name: string, alias: string, filePaths: string[], basePath: string, tagIds?: string[]) => {
      try {
        const file = await fileService.createBundle(name, alias, filePaths, basePath)
        if (tagIds && tagIds.length > 0) {
          fileService.setFileTags(file.id, tagIds)
          file.tags = fileService.getFileTags(file.id)
        }
        return { success: true, data: file }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('files:list-entries', async (_, fileId: string) => {
    try {
      const entries = await fileService.listBundleEntries(fileId)
      return { success: true, data: entries }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
