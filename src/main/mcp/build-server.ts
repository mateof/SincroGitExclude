import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './tools/common'
import { registerFileTools } from './tools/files.tools'
import { registerDeploymentTools } from './tools/deployments.tools'
import { registerHistoryTools } from './tools/history.tools'
import { registerRepoTools } from './tools/repos.tools'
import { registerConfigTools } from './tools/config.tools'

const INSTRUCTIONS = `SincroGitExclude versions files that must never be committed to the repositories they live in (.env, local config, secrets, helper scripts) and keeps them in sync between repositories and machines.

Model:
- A managed file is either a single file or a bundle (a folder). Each one has its own internal git history.
- A deployment places a managed file inside a git repository (targetPath) and usually adds it to that repository's .git/info/exclude so it is never committed there. Every deployment has its own branch of the history.
- Editing a deployed file leaves uncommitted changes; commit_changes saves them as a new version. Versions move between deployments with compare_with_commit + apply_commit.
- Snapshots are saved automatically between commits while files change.
- Remote sync pushes and pulls every managed file to a single git repository so other machines can deploy them.

Getting around: get_overview, then list_files / get_file, or list_deployments with onlyWithChanges. Paths you pass must be absolute paths on this computer.

Before anything destructive (delete_*, checkout_commit, discard_changes, import_data) tell the user what will be lost. What you change shows up in the open app window straight away, so say what you did.`

export interface BuildOptions {
  version: string
  readOnly: boolean
  onWrite: (tool: string) => void
  selfStatus: () => Record<string, unknown>
}

export function buildMcpServer(options: BuildOptions): McpServer {
  const server = new McpServer(
    { name: 'sincrogitexclude', version: options.version },
    {
      instructions: options.readOnly
        ? `${INSTRUCTIONS}\n\nThis server is read only: nothing can be changed through it. Say so instead of trying.`
        : INSTRUCTIONS
    }
  )
  const ctx: ToolContext = {
    server,
    readOnly: options.readOnly,
    onWrite: options.onWrite,
    selfStatus: options.selfStatus
  }
  registerConfigTools(ctx)
  registerFileTools(ctx)
  registerDeploymentTools(ctx)
  registerHistoryTools(ctx)
  registerRepoTools(ctx)
  return server
}
