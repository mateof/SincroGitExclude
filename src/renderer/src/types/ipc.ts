// IPC Channel names as constants
export const IPC_CHANNELS = {
  // Files
  FILES_LIST: 'files:list',
  FILES_GET: 'files:get',
  FILES_CREATE: 'files:create',
  FILES_UPDATE: 'files:update',
  FILES_DELETE: 'files:delete',
  // Deployments
  DEPLOYMENTS_LIST: 'deployments:list',
  DEPLOYMENTS_CREATE: 'deployments:create',
  DEPLOYMENTS_DEACTIVATE: 'deployments:deactivate',
  DEPLOYMENTS_REACTIVATE: 'deployments:reactivate',
  DEPLOYMENTS_DELETE: 'deployments:delete',
  DEPLOYMENTS_SYNC: 'deployments:sync',
  DEPLOYMENTS_CHECK_CHANGES: 'deployments:check-changes',
  // Commits
  COMMITS_LIST: 'commits:list',
  COMMITS_CREATE: 'commits:create',
  COMMITS_DIFF: 'commits:diff',
  COMMITS_DIFF_WORKING: 'commits:diff-working',
  COMMITS_CHECKOUT: 'commits:checkout',
  COMMITS_FILE_AT: 'commits:file-at',
  // Exclude
  EXCLUDE_ADD: 'exclude:add',
  EXCLUDE_REMOVE: 'exclude:remove',
  EXCLUDE_CHECK: 'exclude:check',
  // Export/Import
  EXPORT_ALL: 'export:all',
  IMPORT_VALIDATE: 'import:validate',
  IMPORT_EXECUTE: 'import:execute',
  // Dialogs
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',
  DIALOG_SELECT_FILE: 'dialog:select-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',
  // Watcher events (push from main)
  WATCHER_FILE_CHANGED: 'watcher:file-changed',
  WATCHER_FILE_DELETED: 'watcher:file-deleted',
} as const

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ImportValidationResult {
  metadata: {
    version: string
    exportDate: string
    fileCount: number
  }
  files: Array<{
    id: string
    name: string
    alias: string
    deployments: Array<{
      id: string
      repoPath: string
      fileRelativePath: string
      repoExists: boolean
      fileExists: boolean
    }>
  }>
}
