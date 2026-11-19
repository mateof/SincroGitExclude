import { z } from 'zod'
import { existsSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { call, readTool, tagNames, ToolFailure, writeTool, type ToolContext } from './common'

export interface DeploymentRowLike {
  id: string
  file_id: string
  repo_path: string
  file_relative_path: string
  branch_name: string
  is_active: number
  last_synced_at: string | null
  created_at: string
  current_commit_hash: string | null
  description: string | null
  tags?: Array<{ name: string }>
}

interface FileRow {
  id: string
  name: string
  type: string
}

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

export async function summarizeDeployment(d: DeploymentRowLike) {
  const active = d.is_active === 1
  const [hasChanges, excluded, exists] = active
    ? await Promise.all([
        safe(call<boolean>('deployments:check-changes', d.id)),
        safe(call<boolean>('deployments:check-exclude', d.id)),
        safe(call<boolean>('deployments:check-file-exists', d.id))
      ])
    : [undefined, undefined, undefined]
  return {
    id: d.id,
    fileId: d.file_id,
    repoPath: d.repo_path.replace(/\\/g, '/'),
    relativePath: d.file_relative_path.replace(/\\/g, '/'),
    fullPath: join(d.repo_path, d.file_relative_path).replace(/\\/g, '/'),
    branch: d.branch_name,
    active,
    hasChanges,
    excluded,
    exists,
    description: d.description,
    tags: tagNames(d.tags),
    currentCommit: d.current_commit_hash,
    lastSyncedAt: d.last_synced_at,
    createdAt: d.created_at
  }
}

function findGitRoot(start: string): string | null {
  let dir = start
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function resolveDeployTarget(
  targetPath: string,
  file: { name: string; type: string }
): { repoPath: string; relativePath: string } {
  if (!isAbsolute(targetPath)) throw new ToolFailure(`Use an absolute path: ${targetPath}`)
  const abs = resolve(targetPath)
  const isBundle = file.type === 'bundle'

  let target = abs
  if (!isBundle) {
    if (existsSync(abs) && statSync(abs).isDirectory()) target = join(abs, file.name)
    else if (basename(abs) !== file.name) {
      throw new ToolFailure(`A single managed file deploys as "${file.name}". Pass its folder or a path ending in ${file.name}`)
    }
  } else if (existsSync(abs) && !statSync(abs).isDirectory()) {
    throw new ToolFailure(`A bundle deploys into a folder, and this is a file: ${abs}`)
  }

  let probe = isBundle ? target : dirname(target)
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const repoPath = findGitRoot(probe)
  if (!repoPath) throw new ToolFailure(`Not inside a git repository: ${abs}`)

  const relativePath = relative(repoPath, target).replace(/\\/g, '/')
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new ToolFailure('The target must be a folder or file inside the repository, not the repository root itself')
  }
  return { repoPath, relativePath }
}

async function findDeployment(id: string): Promise<DeploymentRowLike> {
  const files = await call<FileRow[]>('files:list')
  for (const f of files) {
    const match = (await call<DeploymentRowLike[]>('deployments:list', f.id)).find((d) => d.id === id)
    if (match) return match
  }
  throw new ToolFailure(`Deployment not found: ${id}`)
}

export function registerDeploymentTools(ctx: ToolContext): void {
  readTool(
    ctx,
    'list_deployments',
    {
      title: 'List deployments',
      description:
        'Deployments (a managed file placed inside a git repository) with their status: uncommitted changes, git exclude and whether the files exist. Filter by file or repository, or omit both for all of them.',
      inputSchema: {
        fileId: z.string().optional(),
        repoId: z.string().optional(),
        onlyWithChanges: z.boolean().optional()
      }
    },
    async ({ fileId, repoId, onlyWithChanges }) => {
      let rows: DeploymentRowLike[]
      if (fileId) rows = await call<DeploymentRowLike[]>('deployments:list', fileId)
      else if (repoId) rows = await call<DeploymentRowLike[]>('repos:list-deployments', repoId)
      else {
        const files = await call<FileRow[]>('files:list')
        rows = (await Promise.all(files.map((f) => call<DeploymentRowLike[]>('deployments:list', f.id)))).flat()
      }
      const summaries = await Promise.all(rows.map((d) => summarizeDeployment(d)))
      return onlyWithChanges ? summaries.filter((d) => d.hasChanges) : summaries
    }
  )

  readTool(
    ctx,
    'get_deployment_status',
    {
      title: 'Get deployment status',
      description:
        'Full status of one deployment: changes, which files changed (bundles), and whether it is in .git/info/exclude, in the global excludes file or in .gitignore.',
      inputSchema: { deploymentId: z.string() }
    },
    async ({ deploymentId }) => {
      const d = await findDeployment(deploymentId)
      const [summary, globallyExcluded, inGitignore] = await Promise.all([
        summarizeDeployment(d),
        safe(call<boolean>('exclude:check-global', deploymentId)),
        safe(call<boolean>('gitignore:check', deploymentId))
      ])
      const changedFiles = summary.active ? await safe(call('commits:changed-files', deploymentId)) : undefined
      return { ...summary, globallyExcluded, inGitignore, changedFiles }
    }
  )

  writeTool(
    ctx,
    'create_deployment',
    {
      title: 'Deploy a managed file into a repository',
      description:
        'Place a managed file inside a git repository and start tracking it. targetPath is absolute: for a bundle, the folder it lives in; for a single file, its folder or its full path. The repository is detected automatically. By default it is added to .git/info/exclude (the autoExclude setting). It can start from another deployment (sourceDeploymentId), from a deployment of another machine (sourceRemoteRef from list_remote_sources) and optionally from a specific commit.',
      inputSchema: {
        fileId: z.string(),
        targetPath: z.string(),
        sourceDeploymentId: z.string().optional(),
        sourceRemoteRef: z.string().optional(),
        sourceCommit: z.string().optional(),
        autoExclude: z.boolean().optional()
      }
    },
    async ({ fileId, targetPath, sourceDeploymentId, sourceRemoteRef, sourceCommit, autoExclude }) => {
      const file = await call<FileRow | null>('files:get', fileId)
      if (!file) throw new ToolFailure(`File not found: ${fileId}`)
      const { repoPath, relativePath } = resolveDeployTarget(targetPath, file)

      let sourceBranch: string | undefined
      if (sourceDeploymentId) {
        const source = (await call<DeploymentRowLike[]>('deployments:list', fileId)).find((d) => d.id === sourceDeploymentId)
        if (!source) throw new ToolFailure(`The source deployment does not belong to this file: ${sourceDeploymentId}`)
        sourceBranch = source.branch_name
      } else if (sourceRemoteRef) {
        if (!sourceRemoteRef.startsWith('refs/remotes/sge/')) {
          throw new ToolFailure('sourceRemoteRef must come from list_remote_sources')
        }
        sourceBranch = sourceRemoteRef
      }

      const exclude =
        autoExclude ??
        (await call<{ preferences: { autoExclude: boolean } }>('preferences:get')).preferences.autoExclude

      const created = await call<DeploymentRowLike>(
        'deployments:create',
        fileId,
        repoPath,
        relativePath,
        sourceBranch,
        sourceCommit,
        exclude
      )
      return summarizeDeployment(created)
    }
  )

  writeTool(
    ctx,
    'set_deployment_active',
    {
      title: 'Activate or deactivate a deployment',
      description:
        'Deactivating stops watching it and removes it from .git/info/exclude without touching the files; activating does the opposite.',
      inputSchema: { deploymentId: z.string(), active: z.boolean() }
    },
    async ({ deploymentId, active }) => {
      await call(active ? 'deployments:reactivate' : 'deployments:deactivate', deploymentId)
      return { deploymentId, active }
    },
    { idempotent: true }
  )

  writeTool(
    ctx,
    'delete_deployment',
    {
      title: 'Delete a deployment',
      description:
        'Remove a deployment and its internal branch. The deployed files stay on disk unless deleteFromDisk is true. Cannot be undone.',
      inputSchema: { deploymentId: z.string(), deleteFromDisk: z.boolean().optional() }
    },
    async ({ deploymentId, deleteFromDisk }) => {
      await call('deployments:delete', deploymentId, deleteFromDisk === true)
      return { deleted: deploymentId, filesDeleted: deleteFromDisk === true }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'set_deployment_description',
    {
      title: 'Describe a deployment',
      description: 'Set or clear the free-text description of a deployment.',
      inputSchema: { deploymentId: z.string(), description: z.string().nullable() }
    },
    async ({ deploymentId, description }) =>
      summarizeDeployment(await call<DeploymentRowLike>('deployments:update-description', deploymentId, description)),
    { idempotent: true }
  )

  writeTool(
    ctx,
    'remove_files_from_deployment',
    {
      title: 'Delete files from one deployment',
      description:
        'Delete some files of a bundle from this deployment only (relative paths). The bundle keeps tracking them, so they show up as deleted changes.',
      inputSchema: { deploymentId: z.string(), paths: z.array(z.string()).min(1) }
    },
    async ({ deploymentId, paths }) => ({
      removed: await call<string[]>('files:remove-from-deployment', deploymentId, paths)
    }),
    { destructive: true }
  )

  writeTool(
    ctx,
    'set_git_exclude',
    {
      title: 'Add or remove from .git/info/exclude',
      description: 'Make git in the target repository ignore this deployment (excluded: true) or stop ignoring it.',
      inputSchema: { deploymentId: z.string(), excluded: z.boolean() }
    },
    async ({ deploymentId, excluded }) => {
      await call(excluded ? 'exclude:add' : 'exclude:remove', deploymentId)
      return { deploymentId, excluded }
    },
    { idempotent: true }
  )

  writeTool(
    ctx,
    'set_gitignore',
    {
      title: 'Add or remove from .gitignore',
      description:
        "Add this deployment to the target repository's .gitignore (ignored: true) or remove it. Unlike .git/info/exclude, .gitignore is usually committed and shared.",
      inputSchema: { deploymentId: z.string(), ignored: z.boolean() }
    },
    async ({ deploymentId, ignored }) => {
      await call(ignored ? 'gitignore:add' : 'gitignore:remove', deploymentId)
      return { deploymentId, ignored }
    },
    { idempotent: true }
  )
}
