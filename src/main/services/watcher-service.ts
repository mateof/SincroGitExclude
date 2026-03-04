import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import log from 'electron-log'

export type FileChangeCallback = (deploymentId: string, filePath: string) => void

export class WatcherService {
  private watchers: Map<string, chokidar.FSWatcher> = new Map()
  private mainWindow: BrowserWindow | null = null
  private onChangeCallbacks: FileChangeCallback[] = []

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  onFileChange(callback: FileChangeCallback): void {
    this.onChangeCallbacks.push(callback)
  }

  async watchDeployment(deploymentId: string, fullPath: string): Promise<void> {
    if (this.watchers.has(deploymentId)) return

    const watcher = chokidar.watch(fullPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      },
      usePolling: false
    })

    watcher.on('change', (changedPath) => {
      log.debug(`File changed: ${changedPath} (deployment: ${deploymentId})`)
      this.mainWindow?.webContents.send('watcher:file-changed', deploymentId)
      for (const cb of this.onChangeCallbacks) cb(deploymentId, changedPath as string)
    })

    watcher.on('add', (changedPath) => {
      log.debug(`File added: ${changedPath} (deployment: ${deploymentId})`)
      this.mainWindow?.webContents.send('watcher:file-changed', deploymentId)
      for (const cb of this.onChangeCallbacks) cb(deploymentId, changedPath as string)
    })

    watcher.on('unlink', () => {
      log.debug(`File deleted: ${fullPath} (deployment: ${deploymentId})`)
      this.mainWindow?.webContents.send('watcher:file-deleted', deploymentId)
    })

    watcher.on('error', (error) => {
      log.error(`Watcher error for ${deploymentId}:`, error)
    })

    this.watchers.set(deploymentId, watcher)
    log.info(`Started watching ${fullPath} (deployment: ${deploymentId})`)
  }

  async unwatchDeployment(deploymentId: string): Promise<void> {
    const watcher = this.watchers.get(deploymentId)
    if (watcher) {
      await watcher.close()
      this.watchers.delete(deploymentId)
      log.info(`Stopped watching deployment ${deploymentId}`)
    }
  }

  async unwatchAll(): Promise<void> {
    for (const [id, watcher] of this.watchers) {
      await watcher.close()
    }
    this.watchers.clear()
    log.info('Stopped all watchers')
  }

  isWatching(deploymentId: string): boolean {
    return this.watchers.has(deploymentId)
  }
}
