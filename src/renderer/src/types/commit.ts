export interface CommitInfo {
  hash: string
  message: string
  date: string
  tag?: string
}

export interface CreateCommitInput {
  deploymentId: string
  message: string
  tag?: string
}
