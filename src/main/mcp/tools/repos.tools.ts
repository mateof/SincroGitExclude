import { z } from 'zod'
import { isAbsolute } from 'path'
import { call, readTool, resolveTagIds, ToolFailure, writeTool, type ToolContext } from './common'

export function registerRepoTools(ctx: ToolContext): void {
  readTool(
    ctx,
    'list_repos',
    {
      title: 'List repositories',
      description: 'Git repositories known to the app: the ones with deployments and the ones added by hand.',
      inputSchema: {}
    },
    async () => call('repos:list')
  )

  readTool(
    ctx,
    'get_repo',
    {
      title: 'Get a repository',
      description: 'A repository with its deployments and every line of its .git/info/exclude (with line numbers).',
      inputSchema: { repoId: z.string() }
    },
    async ({ repoId }) => {
      const [repo, deployments, excludes] = await Promise.all([
        call('repos:get', repoId),
        call('repos:list-deployments', repoId),
        call('repos:list-excludes', repoId)
      ])
      return { repo, deployments, excludes }
    }
  )

  writeTool(
    ctx,
    'add_repo',
    {
      title: 'Add a repository',
      description: 'Register a git repository (absolute path) to manage its .git/info/exclude from the app.',
      inputSchema: {
        path: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ path, description, tags }) => {
      if (!isAbsolute(path)) throw new ToolFailure(`Use an absolute path: ${path}`)
      return call('repos:add', path, description, await resolveTagIds(tags))
    }
  )

  writeTool(
    ctx,
    'remove_repo',
    {
      title: 'Forget a repository',
      description: 'Remove a repository from the app. Nothing on disk changes.',
      inputSchema: { repoId: z.string() }
    },
    async ({ repoId }) => {
      await call('repos:remove', repoId)
      return { removed: repoId }
    }
  )

  writeTool(
    ctx,
    'set_repo_description',
    {
      title: 'Describe a repository',
      description: 'Set or clear the description of a repository.',
      inputSchema: { repoId: z.string(), description: z.string().nullable() }
    },
    async ({ repoId, description }) => call('repos:update-description', repoId, description),
    { idempotent: true }
  )

  writeTool(
    ctx,
    'add_repo_exclude',
    {
      title: 'Add a line to .git/info/exclude',
      description: 'Add a gitignore pattern to the .git/info/exclude of a repository, e.g. "local/" or "*.env".',
      inputSchema: { repoId: z.string(), pattern: z.string().min(1) }
    },
    async ({ repoId, pattern }) => {
      const check = await call<{
        isOutsideRepo: boolean
        exists: boolean
        isGlob: boolean
        caseMismatch: boolean
        actualName: string | null
      }>('repos:validate-pattern', repoId, pattern)
      if (check.isOutsideRepo) throw new ToolFailure(`The pattern points outside the repository: ${pattern}`)
      const result = await call('repos:add-exclude', repoId, pattern)
      const warnings: string[] = []
      if (!check.isGlob && !check.exists) warnings.push('Nothing in the repository matches this path yet')
      if (check.caseMismatch) warnings.push(`Case differs from the file on disk: ${check.actualName}`)
      return { result, warnings }
    }
  )

  writeTool(
    ctx,
    'remove_repo_exclude',
    {
      title: 'Remove a line from .git/info/exclude',
      description:
        'Remove one line from .git/info/exclude. lineNumber and pattern come from get_repo; the pattern is checked so a file edited in between is not damaged.',
      inputSchema: { repoId: z.string(), lineNumber: z.number().int().positive(), pattern: z.string() }
    },
    async ({ repoId, lineNumber, pattern }) => call('repos:remove-exclude', repoId, lineNumber, pattern),
    { destructive: true }
  )
}
