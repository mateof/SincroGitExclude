import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { existsSync, readdirSync, statSync, mkdirSync, cpSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname, basename, relative, sep } from 'path'
import {
  APP_DATA_DIR,
  DEFAULT_DATA_DIR,
  CONFIG_FILE_PATH,
  DB_PATH,
  FILES_DIR
} from '../app-paths'
import log from 'electron-log'

/**
 * Walk up from a file path to find the nearest parent directory that contains .git
 */
function findGitRoot(filePath: string): string | null {
  let dir = dirname(filePath)
  const root = dir.split(sep)[0] + sep // e.g. "D:\"

  while (dir !== root) {
    if (existsSync(join(dir, '.git'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Check root too
  if (existsSync(join(dir, '.git'))) {
    return dir
  }
  return null
}

/**
 * Recursively list all files in a directory (skipping .git)
 */
function listFilesRecursive(dirPath: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Given a list of selected paths (files and/or directories), classify them as
 * a single file or a bundle, resolve git info, and return a SelectItemsResult.
 * Used by both the native dialog handler and the drag-and-drop handler.
 */
function resolveItems(
  selectedPaths: string[],
  singleDirSelected: boolean
): {
  success: boolean
  data?: Record<string, unknown>
  error?: string
} {
  const allFiles: string[] = []
  let hasDirectory = false

  for (const p of selectedPaths) {
    const stat = statSync(p)
    if (stat.isDirectory()) {
      hasDirectory = true
      allFiles.push(...listFilesRecursive(p))
    } else {
      allFiles.push(p)
    }
  }

  if (allFiles.length === 0) {
    return { success: false, error: 'No files found' }
  }

  // Single file selected → type 'file'
  if (allFiles.length === 1 && !hasDirectory) {
    const filePath = allFiles[0]
    const fileName = basename(filePath)
    const gitRoot = findGitRoot(filePath)

    return {
      success: true,
      data: {
        type: 'file' as const,
        fileName,
        filePath,
        repoPath: gitRoot,
        fileRelativePath: gitRoot
          ? relative(gitRoot, filePath).replace(/\\/g, '/')
          : null
      }
    }
  }

  // Multiple files or directory → type 'bundle'
  const parts = allFiles.map((p) => p.replace(/\\/g, '/').split('/'))
  let commonParts = [...parts[0]]
  for (let i = 1; i < parts.length; i++) {
    let j = 0
    while (
      j < commonParts.length &&
      j < parts[i].length &&
      commonParts[j] === parts[i][j]
    ) {
      j++
    }
    commonParts = commonParts.slice(0, j)
  }

  const basePath =
    singleDirSelected
      ? selectedPaths[0]
      : commonParts.join('/')

  const relativePaths = allFiles.map((fp) =>
    relative(basePath, fp).replace(/\\/g, '/')
  )

  const gitRoot = findGitRoot(allFiles[0])
  let repoPath: string | null = null
  let baseRelativePath: string | null = null

  if (gitRoot) {
    repoPath = gitRoot
    baseRelativePath = relative(gitRoot, basePath).replace(/\\/g, '/')
    if (baseRelativePath === '') baseRelativePath = '.'
  }

  const folderName = basePath.replace(/\\/g, '/').split('/').pop() || 'bundle'

  return {
    success: true,
    data: {
      type: 'bundle' as const,
      folderName,
      filePaths: allFiles,
      basePath,
      relativePaths,
      repoPath,
      baseRelativePath
    }
  }
}

export function registerAppHandlers(): void {
  ipcMain.handle('dialog:select-directory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:select-file', async (_, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:save-file', async (_, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    })

    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Given a full file path, resolve its filename, git repo root, and relative path
  ipcMain.handle('dialog:resolve-file-info', async (_, filePath: string) => {
    try {
      const fileName = basename(filePath)
      const gitRoot = findGitRoot(filePath)

      if (!gitRoot) {
        return {
          success: true,
          data: {
            fileName,
            fullPath: filePath,
            repoPath: null,
            fileRelativePath: null
          }
        }
      }

      const relPath = relative(gitRoot, filePath).replace(/\\/g, '/')

      return {
        success: true,
        data: {
          fileName,
          fullPath: filePath,
          repoPath: gitRoot,
          fileRelativePath: relPath
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Select multiple files
  ipcMain.handle('dialog:select-files', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  // Select a folder and return its contents
  ipcMain.handle('dialog:select-folder-contents', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const folderPath = result.filePaths[0]
    try {
      const files = listFilesRecursive(folderPath)
      return { folderPath, files }
    } catch (error) {
      return null
    }
  })

  // Resolve bundle info: given file paths and base, compute relative paths and detect git repo
  ipcMain.handle(
    'dialog:resolve-bundle-info',
    async (_, filePaths: string[], basePath: string) => {
      try {
        const relativePaths = filePaths.map((fp) =>
          relative(basePath, fp).replace(/\\/g, '/')
        )
        const gitRoot = findGitRoot(filePaths[0])

        let repoPath: string | null = null
        let baseRelativePath: string | null = null

        if (gitRoot) {
          repoPath = gitRoot
          baseRelativePath = relative(gitRoot, basePath).replace(/\\/g, '/')
          if (baseRelativePath === '') baseRelativePath = '.'
        }

        return {
          success: true,
          data: {
            basePath,
            filePaths,
            relativePaths,
            repoPath,
            baseRelativePath
          }
        }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Resolve deploy target: given a full path (file or directory), find git root + relative path
  ipcMain.handle('dialog:resolve-deploy-target', async (_, targetPath: string) => {
    try {
      const stat = statSync(targetPath)
      const isDir = stat.isDirectory()

      // For directories, start searching from the dir itself; for files, from its parent
      let dir = isDir ? targetPath : dirname(targetPath)
      const root = dir.split(sep)[0] + sep
      let gitRoot: string | null = null

      while (true) {
        if (existsSync(join(dir, '.git'))) {
          gitRoot = dir
          break
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }

      return {
        success: true,
        data: {
          fullPath: targetPath,
          isDirectory: isDir,
          repoPath: gitRoot,
          relativePath: gitRoot ? (relative(gitRoot, targetPath).replace(/\\/g, '/') || '.') : null
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Unified selection: single dialog that auto-detects file vs folder vs multiple
  ipcMain.handle('dialog:select-items', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })

    if (result.canceled || result.filePaths.length === 0) return null

    try {
      const hasDirectory =
        result.filePaths.length === 1 && statSync(result.filePaths[0]).isDirectory()
      return resolveItems(result.filePaths, hasDirectory)
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Resolve items from drag-and-drop paths (same logic as dialog:select-items but without dialog)
  ipcMain.handle('dialog:resolve-items', async (_, paths: string[]) => {
    if (!paths || paths.length === 0) return { success: false, error: 'No paths provided' }

    try {
      const hasDirectory =
        paths.length === 1 && existsSync(paths[0]) && statSync(paths[0]).isDirectory()
      return resolveItems(paths, hasDirectory)
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Open a path in the system file explorer (highlights the item)
  ipcMain.handle('shell:show-in-folder', async (_, targetPath: string) => {
    try {
      shell.showItemInFolder(targetPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Get current data paths
  ipcMain.handle('app:get-paths', async () => {
    return {
      success: true,
      data: {
        dbPath: DB_PATH,
        filesDir: FILES_DIR,
        appDataDir: APP_DATA_DIR,
        isCustom: APP_DATA_DIR !== DEFAULT_DATA_DIR,
        appVersion: app.getVersion()
      }
    }
  })

  // Open a directory in the system file explorer
  ipcMain.handle('app:open-path', async (_, dirPath: string) => {
    try {
      await shell.openPath(dirPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Change the data directory location
  ipcMain.handle(
    'app:change-data-dir',
    async (_, newDir: string, copyDb: boolean, copyFiles: boolean) => {
      try {
        if (!existsSync(newDir) || !statSync(newDir).isDirectory()) {
          return { success: false, error: 'Invalid directory' }
        }

        // Create subdirectories
        mkdirSync(join(newDir, 'files'), { recursive: true })
        mkdirSync(join(newDir, 'temp'), { recursive: true })

        // Copy database
        if (copyDb && existsSync(DB_PATH)) {
          cpSync(DB_PATH, join(newDir, 'sincrogitexclude.db'))
          // Also copy WAL/SHM if present
          const walPath = DB_PATH + '-wal'
          const shmPath = DB_PATH + '-shm'
          if (existsSync(walPath)) cpSync(walPath, join(newDir, 'sincrogitexclude.db-wal'))
          if (existsSync(shmPath)) cpSync(shmPath, join(newDir, 'sincrogitexclude.db-shm'))
        }

        // Copy files directory
        if (copyFiles && existsSync(FILES_DIR)) {
          cpSync(FILES_DIR, join(newDir, 'files'), { recursive: true })
        }

        // Save config
        writeFileSync(CONFIG_FILE_PATH, JSON.stringify({ dataDir: newDir }, null, 2))
        log.info(`Data directory changed to: ${newDir}`)

        // Relaunch
        app.relaunch()
        app.quit()

        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Open external URL in default browser
  ipcMain.handle('shell:open-external', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Reset data directory to default
  ipcMain.handle('app:reset-data-dir', async () => {
    try {
      if (existsSync(CONFIG_FILE_PATH)) {
        unlinkSync(CONFIG_FILE_PATH)
      }
      log.info('Data directory reset to default')
      app.relaunch()
      app.quit()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
