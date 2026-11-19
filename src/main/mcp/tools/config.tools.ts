import { z } from 'zod'
import { isAbsolute } from 'path'
import { call, readTool, ToolFailure, writeTool, type ToolContext } from './common'

interface ServerState {
  token?: string
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: string
  message: string
}

async function webAccessState(): Promise<Record<string, unknown>> {
  const state = { ...(await call<ServerState>('server:get-state')) }
  delete state.token
  return state
}

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new ToolFailure(`Use an absolute path: ${path}`)
  return path
}

export function registerConfigTools(ctx: ToolContext): void {
  readTool(
    ctx,
    'get_overview',
    {
      title: 'Overview',
      description: 'Start here: how many files and deployments there are, how many have pending changes, and where the data lives.',
      inputSchema: {}
    },
    async () => {
      const [stats, files, paths] = await Promise.all([
        call<Record<string, unknown>>('deployments:stats'),
        call<Array<{ type: string }>>('files:list'),
        call<Record<string, unknown>>('app:get-paths')
      ])
      return {
        files: files.length,
        bundles: files.filter((f) => f.type === 'bundle').length,
        ...stats,
        dataDir: paths.appDataDir,
        appVersion: paths.appVersion
      }
    }
  )

  readTool(
    ctx,
    'get_settings',
    {
      title: 'Get settings',
      description:
        'Every setting reachable from here: behaviour preferences, data location, web access, remote sync and this MCP server. Tokens are never returned.',
      inputSchema: {}
    },
    async () => {
      const [preferences, paths, webAccess, sync] = await Promise.all([
        call<{ preferences: unknown }>('preferences:get'),
        call('app:get-paths'),
        webAccessState(),
        call('sync:get-config')
      ])
      return { preferences: preferences.preferences, paths, webAccess, sync, mcp: ctx.selfStatus() }
    }
  )

  writeTool(
    ctx,
    'update_settings',
    {
      title: 'Update settings',
      description:
        'autoExclude: new deployments go to .git/info/exclude by default. snapshotsEnabled: save automatic snapshots while files change. verboseLogs: write debug lines to the log file.',
      inputSchema: {
        autoExclude: z.boolean().optional(),
        snapshotsEnabled: z.boolean().optional(),
        verboseLogs: z.boolean().optional()
      }
    },
    async (patch) => call('preferences:set', patch),
    { idempotent: true }
  )

  writeTool(
    ctx,
    'set_web_access',
    {
      title: 'Start, stop or move the web access',
      description:
        'The web access serves the app to a browser. Start or stop it and change its port. Opening it to the network can only be done from the desktop window.',
      inputSchema: {
        running: z.boolean().optional(),
        port: z.number().int().min(1).max(65535).optional()
      }
    },
    async ({ running, port }) => {
      if (port !== undefined) await call('server:set-config', { port })
      if (running === true) await call('server:start')
      if (running === false) await call('server:stop')
      return webAccessState()
    },
    { idempotent: true }
  )

  readTool(
    ctx,
    'browse_folder',
    {
      title: 'Browse a folder',
      description:
        'List the folders and files of a directory on this computer, marking which folders are git repositories. Without path, starts at the home folder. Handy for clients that cannot see the disk themselves.',
      inputSchema: { path: z.string().optional() }
    },
    async ({ path }) => call('fs:browse', path ? absolute(path) : undefined)
  )

  readTool(
    ctx,
    'read_logs',
    {
      title: 'Read the application log',
      description: 'Latest log entries, oldest first. Useful to explain why an operation failed.',
      inputSchema: {
        limit: z.number().int().positive().max(5000).optional(),
        level: z.enum(['error', 'warn', 'info', 'debug']).optional().describe('Only this level and above'),
        contains: z.string().optional()
      }
    },
    async ({ limit, level, contains }) => {
      const order = ['debug', 'info', 'warn', 'error']
      const min = level ? order.indexOf(level) : 0
      const { entries } = await call<{ entries: LogEntry[] }>('logs:read', limit ?? 200)
      return entries.filter(
        (e) =>
          order.indexOf(e.level) >= min &&
          (!contains || e.message.toLowerCase().includes(contains.toLowerCase()))
      )
    }
  )

  writeTool(
    ctx,
    'clear_logs',
    { title: 'Clear the log', description: 'Empty the application log file.', inputSchema: {} },
    async () => {
      await call('logs:clear')
      return { cleared: true }
    },
    { destructive: true, idempotent: true }
  )

  writeTool(
    ctx,
    'export_data',
    {
      title: 'Export everything to a ZIP',
      description: 'Write a ZIP with the database and the history of every managed file to outputPath (absolute, .zip).',
      inputSchema: { outputPath: z.string() }
    },
    async ({ outputPath }) => {
      await call('export:all', absolute(outputPath))
      return { exported: outputPath }
    }
  )

  readTool(
    ctx,
    'inspect_import',
    {
      title: 'Inspect an export ZIP',
      description: 'What an export ZIP contains (version, date, files) without importing anything.',
      inputSchema: { archivePath: z.string() }
    },
    async ({ archivePath }) => call('import:validate', absolute(archivePath))
  )

  writeTool(
    ctx,
    'import_data',
    {
      title: 'Import a ZIP, replacing everything',
      description:
        'Replace ALL the data of the app with the contents of an export ZIP. Everything not in the ZIP is lost. Run inspect_import first and confirm with the user.',
      inputSchema: { archivePath: z.string() }
    },
    async ({ archivePath }) => {
      const path = absolute(archivePath)
      const contents = await call('import:validate', path)
      await call('import:execute', path)
      return { imported: path, contents }
    },
    { destructive: true }
  )

  readTool(
    ctx,
    'get_sync_config',
    {
      title: 'Remote sync settings',
      description: 'Remote repository URL, this machine name and when it last pushed and pulled.',
      inputSchema: {}
    },
    async () => call('sync:get-config')
  )

  writeTool(
    ctx,
    'configure_sync',
    {
      title: 'Configure remote sync',
      description:
        "Set the git URL every managed file is synced to (SSH or HTTPS, authenticated with this machine's git setup) and the name other machines see.",
      inputSchema: { remoteUrl: z.string().optional(), machineName: z.string().optional() }
    },
    async (patch) => call('sync:set-config', patch),
    { idempotent: true }
  )

  readTool(
    ctx,
    'test_sync_connection',
    {
      title: 'Test the sync remote',
      description: 'Check that the remote is reachable and how many files it already holds.',
      inputSchema: { remoteUrl: z.string().optional().describe('Defaults to the configured one') }
    },
    async ({ remoteUrl }) => call('sync:test', remoteUrl),
    { openWorld: true }
  )

  writeTool(
    ctx,
    'sync_push',
    {
      title: 'Push to the remote',
      description:
        'Upload every managed file, its history and metadata. Never overwrites history from another machine: that comes back as a conflict.',
      inputSchema: {}
    },
    async () => call('sync:push'),
    { openWorld: true }
  )

  writeTool(
    ctx,
    'sync_pull',
    {
      title: 'Pull from the remote',
      description:
        'Bring files that only exist in the remote, newer metadata and shared history. Branches of deployments on this machine are never moved.',
      inputSchema: {}
    },
    async () => call('sync:pull'),
    { openWorld: true }
  )

  readTool(
    ctx,
    'list_remote_sources',
    {
      title: 'Deployments of other machines',
      description:
        'Deployments of this file on other machines (after a pull). Their ref can be passed as sourceRemoteRef to create_deployment.',
      inputSchema: { fileId: z.string() }
    },
    async ({ fileId }) => call('sync:remote-sources', fileId)
  )

  readTool(
    ctx,
    'list_remote_commits',
    {
      title: 'Commits of another machine',
      description: 'History of a deployment from another machine, by the ref returned by list_remote_sources.',
      inputSchema: { fileId: z.string(), ref: z.string() }
    },
    async ({ fileId, ref }) => call('sync:remote-commits', fileId, ref)
  )
}
