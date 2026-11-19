import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const IPC_DIR = join(__dirname, '..', 'src', 'main', 'ipc')
const TOOLS_DIR = join(__dirname, '..', 'src', 'main', 'mcp', 'tools')

const NOT_FOR_MCP: Record<string, string> = {
  'app:change-data-dir': 'relaunches the app and would cut the connection',
  'app:reset-data-dir': 'relaunches the app and would cut the connection',
  'app:check-data-exists': 'helper of the data folder dialog',
  'app:open-path': 'opens a window on the desktop',
  'logs:open-folder': 'opens a window on the desktop',
  'shell:open-external': 'opens a window on the desktop',
  'shell:show-in-folder': 'opens a window on the desktop',
  'dialog:select-directory': 'native dialog',
  'dialog:select-file': 'native dialog',
  'dialog:select-files': 'native dialog',
  'dialog:select-items': 'native dialog',
  'dialog:select-folder-contents': 'native dialog',
  'dialog:select-exclude-targets': 'native dialog',
  'dialog:save-file': 'native dialog',
  'dialog:resolve-items': 'tools take absolute paths and resolve them themselves',
  'dialog:resolve-file-info': 'tools take absolute paths and resolve them themselves',
  'dialog:resolve-bundle-info': 'tools take absolute paths and resolve them themselves',
  'dialog:resolve-deploy-target': 'create_deployment resolves the repository itself',
  'dialog:resolve-exclude-targets': 'add_repo_exclude takes the pattern directly',
  'dialog:resolve-folder-contents': 'create_bundle scans the folder itself',
  'exclude:is-git-repo': 'create_deployment and add_repo validate it',
  'exclude:check': 'same answer as deployments:check-exclude',
  'commits:file-at': 'read_files_at_commit covers it with real per-file contents',
  'snapshots:count-for-commit': 'snapshots:counts returns every count at once',
  'deployments:sync': 'only refreshes the change status that every status tool computes',
  'snapshots:set-enabled': 'update_settings persists it, this channel alone would not',
  'logs:set-verbose': 'update_settings persists it, this channel alone would not',
  'logs:info': 'get_settings and read_logs cover it',
  'logs:write': 'the renderer reporting its own errors',
  'preferences:migrate': 'one-off migration from the renderer localStorage',
  'server:set-token': 'credentials of the web access stay with the person',
  'server:regenerate-token': 'credentials of the web access stay with the person',
  'mcp:get-state': 'would hand the MCP token to the assistant',
  'mcp:clients': 'would hand the MCP token to the assistant',
  'mcp:start': 'reconfiguring the MCP server from itself cuts the connection',
  'mcp:stop': 'reconfiguring the MCP server from itself cuts the connection',
  'mcp:set-config': 'reconfiguring the MCP server from itself cuts the connection',
  'mcp:regenerate-token': 'reconfiguring the MCP server from itself cuts the connection'
}

function channelsIn(dir: string, pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const file of readdirSync(dir)) {
    for (const match of readFileSync(join(dir, file), 'utf-8').matchAll(pattern)) found.add(match[1])
  }
  return found
}

describe('MCP coverage', () => {
  const ipc = channelsIn(IPC_DIR, /ipcMain\.handle\(\s*'([a-z-]+:[a-z-]+)'/g)
  const mcp = channelsIn(TOOLS_DIR, /'([a-z-]+:[a-z-]+)'/g)

  it('offers through MCP everything the app can do, or says why not', () => {
    const missing = [...ipc].filter((c) => !mcp.has(c) && !(c in NOT_FOR_MCP)).sort()
    expect(missing).toEqual([])
  })

  it('does not keep exclusions for channels that no longer exist or are now covered', () => {
    const stale = Object.keys(NOT_FOR_MCP).filter((c) => !ipc.has(c) || mcp.has(c)).sort()
    expect(stale).toEqual([])
  })

  it('only calls channels that exist', () => {
    expect([...mcp].filter((c) => !ipc.has(c)).sort()).toEqual([])
  })
})
