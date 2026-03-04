export interface SnapshotInfo {
  id: string
  deploymentId: string
  baseCommitHash: string | null
  createdAt: string
  fileCount: number
  totalSize: number
}
