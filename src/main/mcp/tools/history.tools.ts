import { z } from 'zod'
import { call, readTool, writeTool, type ToolContext } from './common'

interface FileContent {
  path: string
  content: string
}

function pick(files: FileContent[], paths?: string[]): FileContent[] {
  if (!paths || paths.length === 0) return files
  const wanted = new Set(paths)
  return files.filter((f) => wanted.has(f.path))
}

export function registerHistoryTools(ctx: ToolContext): void {
  readTool(
    ctx,
    'list_changed_files',
    {
      title: 'List uncommitted changes',
      description:
        'Files of a bundle deployment that differ from its last commit (added, modified, deleted) with line counts. Single-file deployments: use get_working_diff.',
      inputSchema: { deploymentId: z.string() }
    },
    async ({ deploymentId }) => call('commits:changed-files', deploymentId)
  )

  readTool(
    ctx,
    'get_working_diff',
    {
      title: 'Diff of uncommitted changes',
      description: 'Unified diff between the deployed files and the last commit of the deployment, new files included.',
      inputSchema: { deploymentId: z.string() }
    },
    async ({ deploymentId }) => (await call<string>('commits:diff-working', deploymentId)) || 'No changes.'
  )

  readTool(
    ctx,
    'list_commits',
    {
      title: 'List commits',
      description: 'History of a deployment, newest first, with tags.',
      inputSchema: { deploymentId: z.string(), limit: z.number().int().positive().optional() }
    },
    async ({ deploymentId, limit }) => {
      const commits = await call<unknown[]>('commits:list', deploymentId)
      return limit ? commits.slice(0, limit) : commits
    }
  )

  readTool(
    ctx,
    'get_commit_diff',
    {
      title: 'Diff of a commit',
      description: 'Changes introduced by a commit, or between two commits when compareTo is given.',
      inputSchema: { deploymentId: z.string(), commit: z.string(), compareTo: z.string().optional() }
    },
    async ({ deploymentId, commit, compareTo }) =>
      (await call<string>('commits:diff', deploymentId, commit, compareTo)) || 'No differences.'
  )

  readTool(
    ctx,
    'compare_with_commit',
    {
      title: 'Compare a deployment with any commit',
      description:
        "Diff between the latest commit of a deployment and a commit from another deployment of the same file. Use before apply_commit to see what would change.",
      inputSchema: { deploymentId: z.string(), sourceCommit: z.string() }
    },
    async ({ deploymentId, sourceCommit }) =>
      (await call<string>('commits:cross-diff', deploymentId, sourceCommit)) || 'No differences.'
  )

  readTool(
    ctx,
    'read_files_at_commit',
    {
      title: 'Read files at a commit',
      description: 'Contents of the files of a deployment as they were at a commit. Pass paths to read only some of them.',
      inputSchema: {
        deploymentId: z.string(),
        commit: z.string(),
        paths: z.array(z.string()).optional()
      }
    },
    async ({ deploymentId, commit, paths }) => pick(await call<FileContent[]>('commits:files-at', deploymentId, commit), paths)
  )

  readTool(
    ctx,
    'read_current_files',
    {
      title: 'Read the deployed files',
      description: 'Current contents of the deployed files, uncommitted changes included. Pass paths to read only some of them.',
      inputSchema: { deploymentId: z.string(), paths: z.array(z.string()).optional() }
    },
    async ({ deploymentId, paths }) => pick(await call<FileContent[]>('commits:files-current', deploymentId), paths)
  )

  readTool(
    ctx,
    'list_snapshots',
    {
      title: 'List automatic snapshots',
      description:
        'Snapshots are saved automatically while files change between commits. Without commit, returns how many exist per base commit ("" = before the first commit); with commit (or null), lists them.',
      inputSchema: { deploymentId: z.string(), commit: z.string().nullable().optional() }
    },
    async ({ deploymentId, commit }) =>
      commit === undefined
        ? call('snapshots:counts', deploymentId)
        : call('snapshots:between-commits', deploymentId, commit)
  )

  readTool(
    ctx,
    'get_snapshot',
    {
      title: 'Read a snapshot',
      description:
        'Files saved in a snapshot. With fullState, the complete state at that moment (base commit plus every snapshot up to this one).',
      inputSchema: { snapshotId: z.string(), fullState: z.boolean().optional() }
    },
    async ({ snapshotId, fullState }) => call(fullState ? 'snapshots:full-state' : 'snapshots:files', snapshotId)
  )

  writeTool(
    ctx,
    'commit_changes',
    {
      title: 'Commit changes',
      description:
        'Save the current deployed content as a new version of the deployment. Pass paths to commit only some files of a bundle, and tag to label the version.',
      inputSchema: {
        deploymentId: z.string(),
        message: z.string().min(1),
        tag: z.string().optional(),
        paths: z.array(z.string()).optional()
      }
    },
    async ({ deploymentId, message, tag, paths }) =>
      call('commits:create', deploymentId, message, tag, paths && paths.length > 0 ? paths : undefined)
  )

  writeTool(
    ctx,
    'checkout_commit',
    {
      title: 'Restore a deployment to a commit',
      description:
        'Overwrite the deployed files with their content at a commit. Uncommitted changes to those files are lost; files that did not exist at that commit are left alone.',
      inputSchema: { deploymentId: z.string(), commit: z.string() }
    },
    async ({ deploymentId, commit }) => {
      await call('commits:checkout', deploymentId, commit)
      return { deploymentId, checkedOut: commit }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'restore_files_from_commit',
    {
      title: 'Restore some files from a commit',
      description: 'Overwrite only the given deployed files with their content at a commit.',
      inputSchema: { deploymentId: z.string(), commit: z.string(), paths: z.array(z.string()).min(1) }
    },
    async ({ deploymentId, commit, paths }) => {
      await call('commits:restore-files', deploymentId, commit, paths)
      return { deploymentId, restored: paths }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'discard_changes',
    {
      title: 'Discard uncommitted changes',
      description:
        'Put the deployed files back as in the last commit. With paths (bundles), only those files; files that are new and not committed are never deleted.',
      inputSchema: { deploymentId: z.string(), paths: z.array(z.string()).optional() }
    },
    async ({ deploymentId, paths }) => {
      if (paths && paths.length > 0) await call('commits:discard-files', deploymentId, paths)
      else await call('commits:discard', deploymentId)
      return { deploymentId, discarded: paths ?? 'all' }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'apply_commit',
    {
      title: 'Apply a commit from another deployment',
      description:
        'Bring the files of a commit (usually from another deployment of the same file) into this deployment and commit them. Check first with compare_with_commit.',
      inputSchema: { deploymentId: z.string(), sourceCommit: z.string(), message: z.string().optional() }
    },
    async ({ deploymentId, sourceCommit, message }) =>
      call('commits:apply-from', deploymentId, sourceCommit, message)
  )

  writeTool(
    ctx,
    'apply_snapshot',
    {
      title: 'Apply a snapshot',
      description: 'Overwrite the deployed files with the state saved in a snapshot.',
      inputSchema: { snapshotId: z.string() }
    },
    async ({ snapshotId }) => {
      await call('snapshots:apply', snapshotId)
      return { applied: snapshotId }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'deploy_snapshot',
    {
      title: 'Deploy a snapshot somewhere else',
      description: 'Create a new deployment in destFolder (absolute, inside a git repository) with the state of a snapshot.',
      inputSchema: { snapshotId: z.string(), destFolder: z.string() }
    },
    async ({ snapshotId, destFolder }) => call('snapshots:deploy', snapshotId, destFolder)
  )
}
