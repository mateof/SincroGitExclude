# MCP access

SincroGitExclude speaks MCP (Model Context Protocol) over Streamable HTTP, so AI assistants such as Claude Code, Codex, Gemini CLI, Cursor or GitHub Copilot can use it: list and create managed files, deploy them, review and commit changes, restore versions, sync with the remote and change settings.

The server runs inside the app, so it answers only while the app is open.

## Turning it on

**Settings → MCP access for AI assistants → Start MCP server.**

- **Address**: `http://127.0.0.1:8766/mcp` by default. The port can be changed.
- **Access token**: every request needs `Authorization: Bearer <token>`. The token is separate from the web access token, so revoking one does not affect the other. Regenerating it disconnects every client already set up.
- **Read only**: write tools are not even listed, so the assistant can look but not change anything.
- **Allow connections from other machines**: off by default. When on, anyone on the network with the token can read and change your managed files and run git on this computer, over plain HTTP. Use it only on trusted networks or over a VPN such as Tailscale. With it on, *Keep this computer awake* stops the system from suspending while the server runs, so other computers can reach the knowledge base.
- **Per-device tokens**: besides the main token, which can do everything, you can create a token per computer or assistant with only some permissions: `kb:read`, `kb:write` (knowledge base) and `sge:read`, `sge:write` (managed files). Tools a token cannot use are not listed. A token can also be limited to some knowledge spaces. Each token is revoked on its own, and the commands of the next section can be generated for any of them. `kb:admin` allows adding and configuring knowledge spaces; existing tokens do not have it.

The settings live in `mcp.json` in the app's default data folder, next to `server.json`, never in the configurable data folder.

## Connecting a client

The settings screen builds the exact command or configuration for each client, with the URL and token already in it, for bash/zsh, PowerShell or cmd:

| Client | How |
|---|---|
| Claude Code | `claude mcp add --transport http --scope user sincrogitexclude <url> --header "Authorization: Bearer <token>"` |
| Gemini CLI | `gemini mcp add --scope user --transport http sincrogitexclude <url> --header "Authorization: Bearer <token>"` |
| VS Code (Copilot) | `code --add-mcp '{"name":"sincrogitexclude","type":"http","url":"<url>","headers":{...}}'` |
| Codex CLI | `[mcp_servers.sincrogitexclude]` block in `~/.codex/config.toml` |
| Cursor | entry in `~/.cursor/mcp.json` |
| GitHub Copilot CLI | entry in `~/.copilot/mcp-config.json` |
| opencode | entry under `mcp.servers` in `~/.config/opencode/opencode.json` |
| Claude Desktop | `claude_desktop_config.json` through the `mcp-remote` bridge (needs Node.js) |
| Others | URL plus `Authorization` header |

Notes:

- `--scope user` registers the server for every folder. Without it, Claude Code keeps it private to the folder the command ran in, and Gemini CLI to the current project.
- In Claude Code the `--header` option takes several values, so it goes after the name and the URL.
- Claude Desktop on Windows does not escape spaces inside `args`, so the header is passed as `Authorization:${AUTH_HEADER}` with the value in `env`.

## Tools

Everything the app can do is available, except what only makes sense in front of the screen. A test compares the app's channels with the tools and fails when something new is added to the app without deciding whether it belongs here.

- **Overview and settings**: `get_overview`, `get_settings`, `update_settings` (auto-exclude, snapshots, verbose logs), `set_web_access` (start, stop, port), `browse_folder`, `read_logs`, `clear_logs`, `export_data`, `inspect_import`, `import_data`.
- **Files and bundles**: `list_files`, `get_file`, `create_file`, `create_bundle` (applies ignore patterns while importing a folder), `update_file`, `delete_file`, `set_ignore_patterns`, `add_files_to_bundle`, `remove_files_from_bundle`, `create_file_from_commit`.
- **Tags**: `list_tags`, `create_tag`, `delete_tag`, `set_tags` (by name; missing tags are created).
- **Deployments**: `list_deployments`, `get_deployment_status`, `create_deployment` (detects the repository from an absolute path), `set_deployment_active`, `delete_deployment`, `set_deployment_description`, `remove_files_from_deployment`, `set_git_exclude`, `set_gitignore`.
- **History**: `list_changed_files`, `get_working_diff`, `list_commits`, `get_commit_diff`, `compare_with_commit`, `read_files_at_commit`, `read_current_files`, `commit_changes`, `checkout_commit`, `restore_files_from_commit`, `discard_changes`, `apply_commit`.
- **Snapshots**: `list_snapshots`, `get_snapshot`, `apply_snapshot`, `deploy_snapshot`.
- **Repositories**: `list_repos`, `get_repo`, `add_repo`, `remove_repo`, `set_repo_description`, `add_repo_exclude`, `remove_repo_exclude`.
- **Remote sync**: `get_sync_config`, `configure_sync`, `test_sync_connection`, `sync_push`, `sync_pull`, `list_remote_sources`, `list_remote_commits`.
- **Knowledge base** (see [knowledge-base.md](knowledge-base.md)): `kb_status`, `kb_search` (words, meaning or both), `kb_read` (whole note or one section, with its hash, links and backlinks), `kb_list`, `kb_recent`, `kb_tags`, `kb_repo_context` (the note linked to a repository), `kb_history`, `kb_sync`, `kb_create`, `kb_edit`, `kb_append`, `kb_patch_section`, `kb_set_frontmatter`, `kb_delete` (moves to `.trash/`). Every change needs the `expectedHash` returned by `kb_read`; a note that changed meanwhile is never overwritten. Spaces can refuse writes from assistants or hold them for review before they are pushed. Spaces are set up with `kb_add_space`, `kb_clone_space`, `kb_update_space` (permission `kb:admin`, destinations are allowed in a dialog on the computer) and checked with `kb_test_space`.

`GET /kb/context?space=<id>&note=<path>` on the same port returns the raw Markdown of a note for a token with knowledge read access. The session hook of repositories linked in remote mode uses it.

Destructive tools are marked as such, so clients that ask before running them do. Changes made through MCP show up in the open app window straight away.

## What stays out

- Native dialogs and anything that opens a window on the desktop.
- Moving the data folder, which relaunches the app.
- Opening the web access to the network, and the web access and MCP tokens: tokens are never returned by any tool.
- Reconfiguring the MCP server itself, which would cut the connection it is using, and creating or revoking tokens.
- Adding, moving or forgetting knowledge spaces and changing their settings, linking repositories, reviewing assistant writes, and everything about encryption keys and access: those decisions stay with the person.
