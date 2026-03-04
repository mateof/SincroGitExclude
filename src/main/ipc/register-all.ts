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
import type { SnapshotService } from '../services/snapshot-service'

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
}

export function registerAllHandlers(services: Services): void {
  registerFileHandlers(services.fileService)
  registerDeploymentHandlers(services.deploymentService)
  registerCommitHandlers(services.commitService)
  registerExcludeHandlers(services.gitExcludeService, services.gitService)
  registerExportImportHandlers(services.exportService, services.importService)
  registerAppHandlers()
  registerSnapshotHandlers(services.snapshotService)
}
