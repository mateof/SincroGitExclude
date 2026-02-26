import { ipcMain } from 'electron'
import { ExportService } from '../services/export-service'
import { ImportService } from '../services/import-service'

export function registerExportImportHandlers(
  exportService: ExportService,
  importService: ImportService
): void {
  ipcMain.handle('export:all', async (_, outputPath: string) => {
    try {
      await exportService.exportAll(outputPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('import:validate', async (_, archivePath: string) => {
    try {
      const data = await importService.validateImport(archivePath)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('import:execute', async (_, archivePath: string) => {
    try {
      await importService.executeImport(archivePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
