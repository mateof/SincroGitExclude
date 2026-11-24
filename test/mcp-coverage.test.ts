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
  'mcp:regenerate-token': 'reconfiguring the MCP server from itself cuts the connection',
  'mcp:list-tokens': 'would hand the MCP tokens to the assistant',
  'mcp:create-token': 'credentials of the MCP server stay with the person',
  'mcp:revoke-token': 'reconfiguring the MCP server from itself cuts the connection',
  'kb:add-space': 'adding a folder of this computer as a space is a decision of the person',
  'kb:remove-space': 'forgetting a space is a decision of the person',
  'kb:relocate-space': 'copies a whole folder on the desktop',
  'kb:update-space': 'space settings (backend, review, assistant writes) stay with the person',
  'kb:reindex': 'maintenance from the window',
  'kb:check-path': 'helper of the add space dialog',
  'kb:tree': 'kb_list browses folders one level at a time',
  'kb:get-space': 'kb_status lists every space with the same data',
  'kb:read-note': 'kb_read returns the content with its hash and links',
  'kb:read-asset': 'images for the viewer, assistants read notes',
  'kb:resolve-link': 'kb_read already resolves the links of a note',
  'kb:audit': 'history of assistant writes is for the person reviewing them',
  'kb:review-list': 'reviewing assistant changes is up to the person',
  'kb:review-diff': 'reviewing assistant changes is up to the person',
  'kb:review-approve': 'reviewing assistant changes is up to the person',
  'kb:review-revert': 'reviewing assistant changes is up to the person',
  'kb:open-in-obsidian': 'opens a window on the desktop',
  'kb:show-in-folder': 'opens a window on the desktop',
  'kb:test-backend': 'connection test from the space settings',
  'kb:trust-host': 'trusting a server key stays with the person',
  'kb:set-sftp-passphrase': 'credentials stay with the person',
  'kb:clone-space': 'cloning into a folder of this computer is a decision of the person',
  'kb:reset-sync-state': 'maintenance from the window',
  'kb:repo-link-preview': 'linking a repository is done from its page in the app',
  'kb:repo-link': 'writing files into a repository is a decision of the person',
  'kb:repo-unlink': 'removing files from a repository is a decision of the person',
  'kb:repo-link-get': 'kb_repo_context returns the linked note itself',
  'kb:repo-links': 'kb_repo_context returns the linked note itself',
  'kb:repo-suggestions': 'suggestions are shown in the repository page',
  'kb:semantic-status': 'kb_search falls back to text when semantic search is not ready',
  'kb:semantic-config': 'the embedding model is chosen in Settings',
  'kb:semantic-set-config': 'the embedding model is chosen in Settings, it may download hundreds of MB',
  'kb:semantic-reindex': 'maintenance from the window',
  'kb:crypto-status': 'kb_status says whether a space is encrypted and locked',
  'kb:crypto-generate-passphrase': 'helper of the encryption dialog',
  'kb:crypto-check-passphrase': 'helper of the encryption dialog',
  'kb:crypto-prepare': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-confirm': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-adopt': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-unlock': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-lock': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-remember-device': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-remove-recipient': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-change-passphrase': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-reset-recovery': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-request-access': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-approve': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-reject': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-pairing-check': 'keys and access to encrypted spaces stay with the person',
  'kb:crypto-confirm-pairing': 'keys and access to encrypted spaces stay with the person'
}

function channelsIn(dir: string, pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const file of readdirSync(dir)) {
    for (const match of readFileSync(join(dir, file), 'utf-8').matchAll(pattern)) found.add(match[1])
  }
  return found
}

describe('MCP coverage', () => {
  const ipc = channelsIn(IPC_DIR, /(?:ipcMain\.handle|kbHandle)\(\s*'([a-z-]+:[a-z-]+)'/g)
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
