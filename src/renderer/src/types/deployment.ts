import type { FileTag } from './file'

export interface Deployment {
  id: string
  fileId: string
  repoPath: string
  fileRelativePath: string
  branchName: string
  isActive: boolean
  lastSyncedAt: string | null
  createdAt: string
  currentCommitHash: string | null
  description: string | null
  tags: FileTag[]
  // Computed at runtime
  isExcluded?: boolean
  isGloballyExcluded?: boolean
  isInGitIgnore?: boolean
  hasChanges?: boolean
  fileExists?: boolean
  fullPath?: string
}

export interface CreateDeploymentInput {
  fileId: string
  repoPath: string
  fileRelativePath: string
  sourceBranch?: string
  sourceCommit?: string
}
