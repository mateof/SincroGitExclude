import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ensureDirectories } from './app-paths'
import { getDb, closeDb } from './database/connection'
import { runMigrations } from './database/migrations'
import { GitService } from './git/git-service'
import { GitExcludeService } from './git/git-exclude'
import { FileService } from './services/file-service'
import { DeploymentService } from './services/deployment-service'
import { CommitService } from './services/commit-service'
import { WatcherService } from './services/watcher-service'
import { ExportService } from './services/export-service'
import { ImportService } from './services/import-service'
import { registerAllHandlers } from './ipc/register-all'
import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.console.level = 'debug'

let mainWindow: BrowserWindow | null = null
let watcherService: WatcherService | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'default',
    title: 'SincroGitExclude',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.sincrogitexclude.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 1. Ensure directories exist
  ensureDirectories()

  // 2. Initialize database
  const db = getDb()
  runMigrations(db)

  // 3. Create services
  const gitService = new GitService()
  const gitExcludeService = new GitExcludeService()
  watcherService = new WatcherService()
  const fileService = new FileService(gitService)
  const deploymentService = new DeploymentService(gitService, gitExcludeService, watcherService)
  const commitService = new CommitService(gitService)
  const exportService = new ExportService()
  const importService = new ImportService(gitExcludeService, watcherService)

  // 4. Register IPC handlers
  registerAllHandlers({
    fileService,
    deploymentService,
    commitService,
    watcherService,
    gitService,
    gitExcludeService,
    exportService,
    importService
  })

  // 5. Create window
  createWindow()
  watcherService.setMainWindow(mainWindow!)

  // 6. Start watchers for active deployments
  try {
    const deployments = db
      .prepare('SELECT * FROM deployments WHERE is_active = 1')
      .all() as Array<{
      id: string
      file_id: string
      repo_path: string
      file_relative_path: string
    }>

    const { existsSync } = await import('fs')
    const { join: pathJoin } = await import('path')

    for (const d of deployments) {
      const fullPath = pathJoin(d.repo_path, d.file_relative_path)
      if (existsSync(fullPath)) {
        await watcherService.watchDeployment(d.id, fullPath)
      }
    }
    log.info(`Started watching ${deployments.length} active deployments`)
  } catch (err) {
    log.error('Failed to start watchers:', err)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  if (watcherService) {
    await watcherService.unwatchAll()
  }
  closeDb()
})
