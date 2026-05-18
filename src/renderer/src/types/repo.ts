import type { FileTag } from './file'

export interface Repo {
  id: string
  path: string
  displayName: string
  description: string | null
  createdAt: string
  updatedAt: string
  deploymentCount: number
  filesCount: number
  lastActivity: string | null
  pathExists: boolean
  isValidGit: boolean
  tags: FileTag[]
  // Lazy / detail-only fields
  currentBranch?: string | null
  remoteUrl?: string | null
  hasUncommittedChangesExternal?: boolean
  excludeEntriesCount?: number
  hasManualExcludes?: boolean
}

export interface LinkedDeployment {
  id: string
  fileId: string
  fileName: string
  fileAlias: string
  fileRelativePath: string
}

export interface ExcludeEntry {
  pattern: string
  managedByApp: boolean
  deploymentId: string | null
  lineNumber: number
  rawLine: string
  linkedDeployment: LinkedDeployment | null
}

export interface RepoDeploymentRow {
  id: string
  fileId: string
  fileName: string
  fileAlias: string
  fileType: 'file' | 'bundle'
  fileRelativePath: string
  branchName: string
  isActive: number
  lastSyncedAt: string | null
  description: string | null
}
