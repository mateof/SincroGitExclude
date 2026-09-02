import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'
import log from 'electron-log'

export type FileChangeCallback = (deploymentId: string, filePath: string) => void

/** Extra push-event sink. Used by the web server to reach browser clients. */
export type EventEmitterFn = (channel: string, ...args: unknown[]) => void

export class WatcherService {
  private watchers: Map<string, chokidar.FSWatcher> = new Map()
  private mainWindow: BrowserWindow | null = null
  private onChangeCallbacks: FileChangeCallback[] = []
  private emitters: EventEmitterFn[] = []

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  onFileChange(callback: FileChangeCallback): void {
    this.onChangeCallbacks.push(callback)
  }

  /**
   * Register an additional destination for watcher events.
   *
   * The Electron window keeps getting them through `webContents.send`; this is
   * how browser clients get the same events without the watcher knowing that a
   * second transport exists.
   */
  addEmitter(emitter: EventEmitterFn): void {
    this.emitters.push(emitter)
  }

  /** Sends a push event to the Electron window and to every extra emitter. */
  private emit(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args)
    for (const emitter of this.emitters) {
      try {
        emitter(channel, ...args)
      } catch (error) {
        log.warn(`Emitter failed for ${channel}:`, error)
      }
    }
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
      this.emit('watcher:file-changed', deploymentId)
      for (const cb of this.onChangeCallbacks) cb(deploymentId, changedPath as string)
    })

    watcher.on('add', (changedPath) => {
      log.debug(`File added: ${changedPath} (deployment: ${deploymentId})`)
      this.emit('watcher:file-changed', deploymentId)
      for (const cb of this.onChangeCallbacks) cb(deploymentId, changedPath as string)
    })

    watcher.on('unlink', () => {
      log.debug(`File deleted: ${fullPath} (deployment: ${deploymentId})`)
      this.emit('watcher:file-deleted', deploymentId)
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
