import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ensureDirectories, FILES_DIR } from './app-paths'
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
import { SnapshotService } from './services/snapshot-service'
import { RepoService } from './services/repo-service'
import { ignorePatternsOf } from './services/deployment-context'
import { SyncService } from './sync/sync-service'
import { KbService } from './kb/kb-service'
import { KbSyncService } from './kb/kb-sync-service'
import { KbRepoService } from './kb/kb-repo-service'
import { KbCryptoService } from './kb/kb-crypto-service'
import { SemanticService } from './kb/semantic/semantic-service'
import { UpdateService } from './update/update-service'
import { setKbNoteProvider } from './mcp/mcp-routes'
import { mcpServer } from './mcp/mcp-server'
import { readMcpConfig } from './mcp/mcp-config'
import { addEventSink } from './events'
import { readPreferences, type Preferences } from './preferences'
import { registerAllHandlers } from './ipc/register-all'
import { webServer } from './server/http-server'
import { readServerConfig } from './server/config'
import log from 'electron-log'

log.transports.file.level = 'info'
log.transports.console.level = 'debug'

let mainWindow: BrowserWindow | null = null
let watcherService: WatcherService | null = null
let snapshotService: SnapshotService | null = null
let kbService: KbService | null = null
let kbSyncService: KbSyncService | null = null
let semanticService: SemanticService | null = null
const updateService = new UpdateService()

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
  snapshotService = new SnapshotService(gitService)
  snapshotService.setDeploymentService(deploymentService)
  watcherService.onFileChange((id, paths) => snapshotService?.onFileChanged(id, paths))
  watcherService.setPatternResolver((deploymentId) => {
    const row = db.prepare('SELECT file_id FROM deployments WHERE id = ?').get(deploymentId) as
      | { file_id: string }
      | undefined
    return row ? ignorePatternsOf(row.file_id) : []
  })
  watcherService.setChangeEvaluator((deploymentId) => deploymentService.checkForChanges(deploymentId))
  const repoService = new RepoService(gitService, gitExcludeService)
  const syncService = new SyncService(gitService, (fileId) =>
    deploymentService.restartWatchersForFile(fileId)
  )
  kbService = new KbService()
  kbSyncService = new KbSyncService(kbService)
  const kbCryptoRef: { current: KbCryptoService | null } = { current: null }
  const kbSync = kbSyncService
  kbService.setHooks({
    onLocalWrite: (spaceId, paths, origin) => kbSync.onLocalWrite(spaceId, paths, origin),
    onExternalChange: (spaceId) => kbSync.onExternalChange(spaceId),
    onSpacesChanged: () => kbSync.reschedule(),
    isLocked: (spaceId) => !kbCryptoRef.current?.isUnlockedNow(spaceId)
  })
  const kbRepoService = new KbRepoService(kbService, repoService)
  const kbCryptoService = new KbCryptoService(kbService, {
    rawStoreFor: (spaceId) => kbSync.rawStoreFor(spaceId),
    triggerSync: (spaceId) => void kbSync.syncNow(spaceId).catch(() => undefined),
    machineName: () => kbSync.machineName()
  })
  kbCryptoRef.current = kbCryptoService
  semanticService = new SemanticService(kbService)
  const semantic = semanticService
  kbService.setSemantic({ ready: () => semantic.ready(), search: (query, options) => semantic.search(query, options) })
  addEventSink((channel, payload) => {
    if (channel === 'kb:changed') semantic.onSpaceChanged((payload as { spaceId: string }).spaceId)
  })
  kbSync.setEncryption({
    ensureUnlocked: (spaceId) => kbCryptoService.ensureUnlocked(spaceId),
    canPublish: (spaceId) => kbCryptoService.canPublish(spaceId),
    wrapStore: (spaceId, raw) => kbCryptoService.wrapStore(spaceId, raw),
    gitMirrorStore: (spaceId, url, branch) => kbCryptoService.gitMirrorStore(spaceId, url, branch)
  })
  const kbForRoutes = kbService
  setKbNoteProvider(async (spaceId, notePath) => (await kbForRoutes.readRaw(spaceId, notePath)).content)

  // 3b. Apply core.fileMode=false to existing internal repos to avoid
  // false-positive "changed" detection due to file mode differences
  try {
    if (existsSync(FILES_DIR)) {
      for (const entry of readdirSync(FILES_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const repoPath = join(FILES_DIR, entry.name)
          if (existsSync(join(repoPath, '.git'))) {
            await gitService.ensureCoreFileMode(repoPath)
          }
        }
      }
    }
  } catch (err) {
    log.warn('Could not apply core.fileMode to existing repos:', err)
  }

  const applyPreferences = (preferences: Preferences): void => {
    snapshotService?.setEnabled(preferences.snapshotsEnabled)
    log.transports.file.level = preferences.verboseLogs ? 'debug' : 'info'
  }
  applyPreferences(readPreferences().preferences)

  // 4. Register IPC handlers
  registerAllHandlers({
    fileService,
    deploymentService,
    commitService,
    watcherService,
    gitService,
    gitExcludeService,
    exportService,
    importService,
    snapshotService,
    repoService,
    syncService,
    kbService,
    kbSyncService,
    kbRepoService,
    kbCryptoService,
    semanticService,
    updateService,
    applyPreferences
  })

  // 5. Create window
  createWindow()
  watcherService.setMainWindow(mainWindow!)

  // 5b. Browser clients get the same push events as the desktop window
  watcherService.addEmitter((channel, ...args) => webServer.broadcast(channel, ...args))
  addEventSink((channel, ...args) => mainWindow?.webContents.send(channel, ...args))
  addEventSink((channel, ...args) => webServer.broadcast(channel, ...args))

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

  void kbService
    .init()
    .then(() => {
      kbSync.start()
      void semantic.start()
    })
    .catch((err) => log.error('Failed to start the knowledge base:', err))

  // 7. Start the web server if the user left it enabled
  try {
    if (readServerConfig().enabled) {
      await webServer.start()
    }
  } catch (err) {
    // A busy port must not stop the desktop app from working
    log.error('Failed to start web server:', err)
  }

  try {
    if (readMcpConfig().enabled) {
      await mcpServer.start()
    }
  } catch (err) {
    log.error('Failed to start MCP server:', err)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  updateService.dispose()
  await mcpServer.stop()
  await webServer.stop()
  if (watcherService) {
    await watcherService.unwatchAll()
  }
  snapshotService?.dispose()
  kbSyncService?.dispose()
  await semanticService?.dispose()
  await kbService?.dispose()
  closeDb()
})
