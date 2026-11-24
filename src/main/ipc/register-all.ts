import { ipcMain } from 'electron'
import { registerChannel, type ChannelHandler } from './channel-registry'
import log from 'electron-log'
import { FileService } from '../services/file-service'
import { DeploymentService } from '../services/deployment-service'
import { CommitService } from '../services/commit-service'
import { WatcherService } from '../services/watcher-service'
import { GitService } from '../git/git-service'
import { GitExcludeService } from '../git/git-exclude'
import { ExportService } from '../services/export-service'
import { ImportService } from '../services/import-service'
import { registerFileHandlers } from './file-handlers'
import { registerDeploymentHandlers } from './deployment-handlers'
import { registerCommitHandlers } from './commit-handlers'
import { registerExcludeHandlers } from './exclude-handlers'
import { registerExportImportHandlers } from './export-import-handlers'
import { registerAppHandlers } from './app-handlers'
import { registerSnapshotHandlers } from './snapshot-handlers'
import { registerRepoHandlers } from './repo-handlers'
import { registerLogHandlers } from './log-handlers'
import { registerServerHandlers } from './server-handlers'
import { registerSyncHandlers } from './sync-handlers'
import { registerMcpHandlers } from './mcp-handlers'
import { registerPreferencesHandlers } from './preferences-handlers'
import { registerKbHandlers } from './kb-handlers'
import { registerKbSyncHandlers } from './kb-sync-handlers'
import { registerKbRepoHandlers } from './kb-repo-handlers'
import { registerKbCryptoHandlers } from './kb-crypto-handlers'
import { registerKbSemanticHandlers } from './kb-semantic-handlers'
import type { SemanticService } from '../kb/semantic/semantic-service'
import type { KbCryptoService } from '../kb/kb-crypto-service'
import type { KbRepoService } from '../kb/kb-repo-service'
import type { KbService } from '../kb/kb-service'
import type { KbSyncService } from '../kb/kb-sync-service'
import type { Preferences } from '../preferences'
import type { SnapshotService } from '../services/snapshot-service'
import type { RepoService } from '../services/repo-service'
import type { SyncService } from '../sync/sync-service'

/** Channels called constantly by the UI — logging them would drown the log */
const QUIET_CHANNELS = new Set([
  'logs:read',
  'logs:info',
  'logs:write',
  'app:get-paths'
])

function formatArgs(args: unknown[]): string {
  const text = args
    .map((a) => {
      if (a === undefined) return 'undefined'
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(', ')
  return text.length > 300 ? text.slice(0, 300) + '…' : text
}

/**
 * Wraps ipcMain.handle so every IPC call is traceable from the in-app log
 * viewer: calls at debug level (only written to file in verbose mode) and
 * failures at warn/error level (always written).
 *
 * Without this, a handler that returns `{ success: false, error }` leaves no
 * trace anywhere — the renderer used to swallow the message and show a generic
 * one, which made real causes impossible to diagnose.
 *
 * The same wrapper also records each handler in the channel registry so non-IPC
 * transports can reach it without duplicating any registration.
 */
function installIpcLogging(): void {
  const original = ipcMain.handle.bind(ipcMain)

  ipcMain.handle = ((channel: string, listener: ChannelHandler) => {
    const logged: ChannelHandler = async (event, ...args: unknown[]) => {
      const quiet = QUIET_CHANNELS.has(channel)
      if (!quiet) log.debug(`IPC → ${channel}(${formatArgs(args)})`)

      try {
        const result = await listener(event, ...args)
        const failed =
          result !== null &&
          typeof result === 'object' &&
          'success' in (result as Record<string, unknown>) &&
          (result as Record<string, unknown>).success === false
        if (failed) {
          const error = (result as Record<string, unknown>).error
          log.warn(`IPC ✗ ${channel}(${formatArgs(args)}): ${error}`)
        } else if (!quiet) {
          log.debug(`IPC ← ${channel}`)
        }
        return result
      } catch (error) {
        log.error(`IPC ✗ ${channel}(${formatArgs(args)}) threw:`, error)
        throw error
      }
    }

    registerChannel(channel, logged)
    original(channel, logged)
  }) as typeof ipcMain.handle
}

interface Services {
  fileService: FileService
  deploymentService: DeploymentService
  commitService: CommitService
  watcherService: WatcherService
  gitService: GitService
  gitExcludeService: GitExcludeService
  exportService: ExportService
  importService: ImportService
  snapshotService: SnapshotService
  repoService: RepoService
  syncService: SyncService
  kbService: KbService
  kbSyncService: KbSyncService
  kbRepoService: KbRepoService
  kbCryptoService: KbCryptoService
  semanticService: SemanticService
  applyPreferences: (preferences: Preferences) => void
}

export function registerAllHandlers(services: Services): void {
  installIpcLogging()

  registerFileHandlers(services.fileService, services.deploymentService)
  registerDeploymentHandlers(services.deploymentService)
  registerCommitHandlers(services.commitService)
  registerExcludeHandlers(services.gitExcludeService, services.gitService)
  registerExportImportHandlers(services.exportService, services.importService)
  registerAppHandlers()
  registerSnapshotHandlers(services.snapshotService)
  registerRepoHandlers(services.repoService, services.gitExcludeService)
  registerLogHandlers()
  registerServerHandlers()
  registerSyncHandlers(services.syncService)
  registerMcpHandlers()
  registerPreferencesHandlers(services.applyPreferences)
  registerKbHandlers(services.kbService)
  registerKbSyncHandlers(services.kbService, services.kbSyncService)
  registerKbRepoHandlers(services.kbRepoService)
  registerKbCryptoHandlers(services.kbCryptoService)
  registerKbSemanticHandlers(services.semanticService)
}
