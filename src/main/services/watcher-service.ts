import chokidar, { type FSWatcher } from 'chokidar'
import { existsSync } from 'fs'
import { relative } from 'path'
import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { ChangeCoalescer, type CoalescedBatch } from './change-coalescer'
import { matchesAnyPattern } from '../utils/file-scanner'

export type FileChangeCallback = (deploymentId: string, filePaths: string[]) => void

/** Extra push-event sink. Used by the web server to reach browser clients. */
export type EventEmitterFn = (channel: string, ...args: unknown[]) => void

export type PatternResolver = (deploymentId: string) => string[]
export type ChangeEvaluator = (deploymentId: string) => Promise<boolean>

const VCS_DIRS = new Set(['.git', '.svn', '.hg'])

export function buildIgnoreMatcher(root: string, patterns: string[]): (path: string) => boolean {
  return (path: string) => {
    const rel = relative(root, path).replace(/\\/g, '/')
    if (!rel || rel.startsWith('..')) return false
    if (rel.split('/').some((segment) => VCS_DIRS.has(segment))) return true
    return matchesAnyPattern(rel, patterns)
  }
}

export class WatcherService {
  private watchers: Map<string, { watcher: FSWatcher; path: string }> = new Map()
  private mainWindow: BrowserWindow | null = null
  private onChangeCallbacks: FileChangeCallback[] = []
  private emitters: EventEmitterFn[] = []
  private patternResolver: PatternResolver = () => []
  private changeEvaluator: ChangeEvaluator | null = null
  private evaluating = new Set<string>()
  private evaluateAgain = new Set<string>()
  private coalescer = new ChangeCoalescer((id, batch) => {
    this.flush(id, batch).catch((error) => log.warn(`Watcher flush failed for ${id}:`, error))
  })

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  setPatternResolver(resolver: PatternResolver): void {
    this.patternResolver = resolver
  }

  setChangeEvaluator(evaluator: ChangeEvaluator): void {
    this.changeEvaluator = evaluator
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

    let patterns: string[] = []
    try {
      patterns = this.patternResolver(deploymentId)
    } catch (error) {
      log.warn(`Could not resolve ignore patterns for ${deploymentId}:`, error)
    }

    const watcher = chokidar.watch(fullPath, {
      persistent: true,
      ignoreInitial: true,
      ignored: buildIgnoreMatcher(fullPath, patterns),
      usePolling: false
    })

    watcher.on('change', (changedPath) => this.coalescer.push(deploymentId, changedPath))
    watcher.on('add', (changedPath) => this.coalescer.push(deploymentId, changedPath))
    watcher.on('unlink', (removedPath) => this.coalescer.push(deploymentId, removedPath, true))
    watcher.on('unlinkDir', (removedPath) => this.coalescer.push(deploymentId, removedPath, true))

    watcher.on('error', (error) => {
      log.error(`Watcher error for ${deploymentId}:`, error)
    })

    this.watchers.set(deploymentId, { watcher, path: fullPath })
    log.info(`Started watching ${fullPath} (deployment: ${deploymentId})`)
  }

  private async flush(deploymentId: string, batch: CoalescedBatch): Promise<void> {
    const entry = this.watchers.get(deploymentId)
    if (!entry) return

    log.debug(
      `Watcher batch for ${deploymentId}: ${batch.paths.length} changed${batch.removed ? ', some removed' : ''}`
    )

    if (batch.paths.length > 0) {
      for (const cb of this.onChangeCallbacks) {
        try {
          cb(deploymentId, batch.paths)
        } catch (error) {
          log.warn(`Change callback failed for ${deploymentId}:`, error)
        }
      }
    }

    if (!existsSync(entry.path)) {
      this.emit('watcher:file-deleted', deploymentId)
      return
    }

    await this.evaluate(deploymentId)
  }

  private async evaluate(deploymentId: string): Promise<void> {
    if (this.evaluating.has(deploymentId)) {
      this.evaluateAgain.add(deploymentId)
      return
    }
    this.evaluating.add(deploymentId)
    try {
      do {
        this.evaluateAgain.delete(deploymentId)
        let hasChanges: boolean | undefined
        try {
          hasChanges = this.changeEvaluator ? await this.changeEvaluator(deploymentId) : undefined
        } catch (error) {
          log.warn(`Change check failed for ${deploymentId}:`, error)
        }
        if (this.watchers.has(deploymentId)) {
          this.emit('watcher:file-changed', deploymentId, hasChanges)
        }
      } while (this.evaluateAgain.has(deploymentId))
    } finally {
      this.evaluating.delete(deploymentId)
    }
  }

  async unwatchDeployment(deploymentId: string): Promise<void> {
    const entry = this.watchers.get(deploymentId)
    this.coalescer.cancel(deploymentId)
    if (entry) {
      await entry.watcher.close()
      this.watchers.delete(deploymentId)
      log.info(`Stopped watching deployment ${deploymentId}`)
    }
  }

  async unwatchAll(): Promise<void> {
    this.coalescer.dispose()
    for (const entry of this.watchers.values()) {
      await entry.watcher.close()
    }
    this.watchers.clear()
    log.info('Stopped all watchers')
  }

  isWatching(deploymentId: string): boolean {
    return this.watchers.has(deploymentId)
  }
}
