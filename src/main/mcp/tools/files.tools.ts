import { z } from 'zod'
import { existsSync, statSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'
import { scanDirectory } from '../../utils/file-scanner'
import { call, readTool, resolveTagIds, tagNames, ToolFailure, writeTool, type ToolContext } from './common'
import { summarizeDeployment, type DeploymentRowLike } from './deployments.tools'

export interface FileRowLike {
  id: string
  name: string
  alias: string
  type: string
  use_auto_icon: number
  created_at: string
  updated_at: string
  tags?: Array<{ name: string }>
}

export function summarizeFile(file: FileRowLike, pending?: Set<string>) {
  return {
    id: file.id,
    name: file.name,
    alias: file.alias,
    type: file.type,
    tags: tagNames(file.tags),
    hasPendingChanges: pending ? pending.has(file.id) : undefined,
    createdAt: file.created_at,
    updatedAt: file.updated_at
  }
}

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new ToolFailure(`Use an absolute path: ${path}`)
  return resolve(path)
}

function commonParent(paths: string[]): string {
  const split = paths.map((p) => dirname(p).replace(/\\/g, '/').split('/'))
  let common = split[0]
  for (const parts of split.slice(1)) {
    let i = 0
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++
    common = common.slice(0, i)
  }
  return common.join('/') || '/'
}

export async function pendingFileIds(): Promise<Set<string>> {
  const stats = await call<{ fileIdsWithChanges: string[] }>('deployments:stats')
  return new Set(stats.fileIdsWithChanges)
}

export function registerFileTools(ctx: ToolContext): void {
  readTool(
    ctx,
    'list_files',
    {
      title: 'List managed files',
      description:
        'Every managed file and bundle, with its tags and whether any of its deployments has uncommitted changes. Filter by text (name or alias) or by tag.',
      inputSchema: {
        query: z.string().optional().describe('Case-insensitive match on name or alias'),
        tag: z.string().optional().describe('Only files carrying this tag name'),
        type: z.enum(['file', 'bundle']).optional()
      }
    },
    async ({ query, tag, type }) => {
      const [files, pending] = await Promise.all([call<FileRowLike[]>('files:list'), pendingFileIds()])
      const q = query?.toLowerCase()
      return files
        .filter((f) => !q || f.name.toLowerCase().includes(q) || f.alias.toLowerCase().includes(q))
        .filter((f) => !tag || tagNames(f.tags).some((t) => t.toLowerCase() === tag.toLowerCase()))
        .filter((f) => !type || f.type === type)
        .map((f) => summarizeFile(f, pending))
    }
  )

  readTool(
    ctx,
    'get_file',
    {
      title: 'Get a managed file',
      description:
        'Details of one managed file: metadata, ignore patterns, the files inside a bundle and its deployments with their status.',
      inputSchema: { fileId: z.string() }
    },
    async ({ fileId }) => {
      const file = await call<FileRowLike | null>('files:get', fileId)
      if (!file) throw new ToolFailure(`File not found: ${fileId}`)
      const [patterns, deployments, pending] = await Promise.all([
        call<string>('files:get-ignore-patterns', fileId),
        call<DeploymentRowLike[]>('deployments:list', fileId),
        pendingFileIds()
      ])
      const entries = file.type === 'bundle' ? await call<string[]>('files:list-entries', fileId) : undefined
      return {
        ...summarizeFile(file, pending),
        ignorePatterns: patterns.split('\n').filter((l) => l.trim()),
        entries,
        deployments: await Promise.all(deployments.map((d) => summarizeDeployment(d)))
      }
    }
  )

  readTool(
    ctx,
    'list_tags',
    {
      title: 'List tags',
      description: 'Tags with their color and how many files use each one.',
      inputSchema: {}
    },
    async () => call('tags:list')
  )

  writeTool(
    ctx,
    'create_file',
    {
      title: 'Create a single managed file',
      description:
        'Start versioning one file. With sourcePath its current content becomes the first version; without it the file starts empty. Deploy it afterwards with create_deployment.',
      inputSchema: {
        name: z.string().describe('File name as it will be deployed, e.g. ".env"'),
        alias: z.string().optional().describe('Friendly name shown in the app; defaults to the name'),
        sourcePath: z.string().optional().describe('Absolute path of an existing file to import'),
        tags: z.array(z.string()).optional().describe('Tag names; missing tags are created')
      }
    },
    async ({ name, alias, sourcePath, tags }) => {
      if (sourcePath && !existsSync(absolute(sourcePath))) throw new ToolFailure(`Not found: ${sourcePath}`)
      const file = await call<FileRowLike>('files:create', name, alias ?? name, await resolveTagIds(tags), sourcePath)
      return summarizeFile(file)
    }
  )

  writeTool(
    ctx,
    'create_bundle',
    {
      title: 'Create a bundle',
      description:
        'Version a whole folder (folderPath) or a list of files (paths) as one unit. Ignore patterns are applied while importing a folder, so node_modules/ or dist/ never get in.',
      inputSchema: {
        name: z.string(),
        alias: z.string().optional(),
        folderPath: z.string().optional().describe('Absolute path of a folder to import recursively'),
        paths: z.array(z.string()).optional().describe('Absolute file paths, as an alternative to folderPath'),
        basePath: z
          .string()
          .optional()
          .describe('Folder the relative paths are computed from when using paths; defaults to their common parent'),
        ignorePatterns: z.array(z.string()).optional().describe('gitignore-like patterns, e.g. ["node_modules/", "*.log"]'),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ name, alias, folderPath, paths, basePath, ignorePatterns, tags }) => {
      let files: string[]
      let base: string
      if (folderPath) {
        base = absolute(folderPath)
        if (!existsSync(base) || !statSync(base).isDirectory()) throw new ToolFailure(`Not a folder: ${folderPath}`)
        files = scanDirectory(base, ignorePatterns ?? []).map((rel) => resolve(base, rel))
      } else if (paths && paths.length > 0) {
        files = paths.map(absolute)
        base = basePath ? absolute(basePath) : commonParent(files)
      } else {
        throw new ToolFailure('Pass folderPath or paths')
      }
      if (files.length === 0) throw new ToolFailure('Nothing to import: the folder is empty or fully ignored')

      const file = await call<FileRowLike>('files:create-bundle', name, alias ?? name, files, base, await resolveTagIds(tags))
      if (ignorePatterns && ignorePatterns.length > 0) {
        await call('files:set-ignore-patterns', file.id, ignorePatterns.join('\n'))
      }
      return { ...summarizeFile(file), importedFiles: files.length }
    }
  )

  writeTool(
    ctx,
    'update_file',
    {
      title: 'Rename a managed file',
      description: 'Change the name, alias or icon setting of a managed file.',
      inputSchema: {
        fileId: z.string(),
        name: z.string().optional(),
        alias: z.string().optional(),
        useAutoIcon: z.boolean().optional()
      }
    },
    async ({ fileId, ...data }) => summarizeFile(await call<FileRowLike>('files:update', fileId, data)),
    { idempotent: true }
  )

  writeTool(
    ctx,
    'delete_file',
    {
      title: 'Delete a managed file',
      description:
        'Delete a managed file, its whole history and all its deployments. Deployed copies stay on disk unless deleteDeployedFiles is true. Cannot be undone.',
      inputSchema: {
        fileId: z.string(),
        deleteDeployedFiles: z.boolean().optional().describe('Also delete the deployed files from every repository')
      }
    },
    async ({ fileId, deleteDeployedFiles }) => {
      const deployments = await call<DeploymentRowLike[]>('deployments:list', fileId)
      for (const d of deployments) {
        await call('deployments:delete', d.id, deleteDeployedFiles === true)
      }
      await call('files:delete', fileId)
      return { deleted: fileId, deploymentsRemoved: deployments.length }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'set_ignore_patterns',
    {
      title: 'Set ignore patterns of a bundle',
      description:
        'Replace the gitignore-like patterns that keep files out of a bundle (dist/, *.log, node_modules/...). Applies to change detection, commits and the file watcher.',
      inputSchema: { fileId: z.string(), patterns: z.array(z.string()) }
    },
    async ({ fileId, patterns }) => {
      await call('files:set-ignore-patterns', fileId, patterns.join('\n'))
      return { fileId, patterns }
    },
    { idempotent: true }
  )

  writeTool(
    ctx,
    'add_files_to_bundle',
    {
      title: 'Add files to a bundle',
      description:
        'Add files to a bundle and commit them on every active deployment branch, so all deployments start tracking them.',
      inputSchema: {
        fileId: z.string(),
        paths: z.array(z.string()).describe('Absolute paths of the files to add'),
        basePath: z.string().describe('Folder the relative paths inside the bundle are computed from')
      }
    },
    async ({ fileId, paths, basePath }) => ({
      added: await call<string[]>('files:add-to-bundle', fileId, paths.map(absolute), absolute(basePath))
    })
  )

  writeTool(
    ctx,
    'remove_files_from_bundle',
    {
      title: 'Remove files from a bundle',
      description:
        'Stop tracking files of a bundle (relative paths as returned by get_file). With deleteFromDisk they are also deleted from every active deployment.',
      inputSchema: {
        fileId: z.string(),
        paths: z.array(z.string()),
        deleteFromDisk: z.boolean().optional()
      }
    },
    async ({ fileId, paths, deleteFromDisk }) => ({
      removed: await call<string[]>('files:remove-from-bundle', fileId, paths, deleteFromDisk === true)
    }),
    { destructive: true }
  )

  writeTool(
    ctx,
    'create_file_from_commit',
    {
      title: 'Create a managed file from a commit',
      description:
        'Start a new managed file (one path) or bundle (several paths) from files of an existing commit of any deployment.',
      inputSchema: {
        name: z.string(),
        alias: z.string().optional(),
        sourceDeploymentId: z.string(),
        commitHash: z.string(),
        paths: z.array(z.string()).min(1).describe('Paths inside that commit, as returned by read_files_at_commit'),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ name, alias, sourceDeploymentId, commitHash, paths, tags }) =>
      summarizeFile(
        await call<FileRowLike>(
          'files:create-from-commit',
          name,
          alias ?? name,
          sourceDeploymentId,
          commitHash,
          paths,
          await resolveTagIds(tags)
        )
      )
  )

  writeTool(
    ctx,
    'create_tag',
    {
      title: 'Create a tag',
      description: 'Create a colored tag. Tags passed by name to other tools are created automatically too.',
      inputSchema: {
        name: z.string(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Hex color, e.g. #22c55e')
      }
    },
    async ({ name, color }) => call('tags:create', name, color ?? '#6366f1')
  )

  writeTool(
    ctx,
    'delete_tag',
    {
      title: 'Delete a tag',
      description: 'Delete a tag (by name or id) and remove it from every file, deployment and repository.',
      inputSchema: { tag: z.string() }
    },
    async ({ tag }) => {
      const [id] = (await resolveTagIds([tag], false)) ?? []
      await call('tags:delete', id)
      return { deleted: tag }
    },
    { destructive: true }
  )

  writeTool(
    ctx,
    'set_tags',
    {
      title: 'Set tags',
      description:
        'Replace the tags of a file, deployment or repository. Tags are given by name; missing ones are created.',
      inputSchema: {
        target: z.enum(['file', 'deployment', 'repo']),
        id: z.string(),
        tags: z.array(z.string())
      }
    },
    async ({ target, id, tags }) => {
      const ids = (await resolveTagIds(tags)) ?? []
      const channel = target === 'file' ? 'files:set-tags' : target === 'deployment' ? 'deployments:set-tags' : 'repos:set-tags'
      await call(channel, id, ids)
      return { target, id, tags }
    },
    { idempotent: true }
  )
}
