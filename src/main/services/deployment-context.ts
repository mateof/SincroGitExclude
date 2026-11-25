import { join } from 'path'
import { FILES_DIR } from '../app-paths'
import { getDb } from '../database/connection'
import { deployedTree, type DeployedTree } from '../git/deployed-tree'

export interface DeploymentLocation {
  id: string
  file_id: string
  repo_path: string
  file_relative_path: string
  branch_name: string
}

export function internalRepoPath(fileId: string): string {
  return join(FILES_DIR, fileId)
}

export function deployedPath(deployment: DeploymentLocation): string {
  return join(deployment.repo_path, deployment.file_relative_path)
}

export function fileTypeOf(fileId: string): string {
  const row = getDb().prepare('SELECT type FROM files WHERE id = ?').get(fileId) as
    | { type: string }
    | undefined
  return row?.type ?? 'file'
}

export function ignorePatternsOf(fileId: string): string[] {
  const row = getDb().prepare('SELECT ignore_patterns FROM files WHERE id = ?').get(fileId) as
    | { ignore_patterns: string | null }
    | undefined
  return (row?.ignore_patterns ?? '')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
}

export function treeOf(deployment: DeploymentLocation): DeployedTree {
  return deployedTree(
    internalRepoPath(deployment.file_id),
    deployment.id,
    deployedPath(deployment),
    deployment.branch_name,
    ignorePatternsOf(deployment.file_id)
  )
}
