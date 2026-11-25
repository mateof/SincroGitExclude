export type Shell = 'bash' | 'powershell' | 'cmd'
export type Platform = 'darwin' | 'win32' | 'linux'

export type ClientId =
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'cursor'
  | 'vscode'
  | 'copilot-cli'
  | 'opencode'
  | 'claude-desktop'
  | 'generic'

export interface ClientSnippet {
  id: ClientId
  label: string
  kind: 'command' | 'config'
  path?: string
  note?: 'merge' | 'nodeRequired' | 'antigravity'
  content: string
}

export interface SnippetInput {
  url: string
  token: string
  shell: Shell
  platform: Platform
  serverName?: string
}

export const DEFAULT_SERVER_NAME = 'sincrogitexclude'

export function quote(value: string, shell: Shell): string {
  if (shell === 'powershell') return `'${value.replace(/'/g, "''")}'`
  if (shell === 'cmd') return `"${value.replace(/"/g, '')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function windowsArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function homePath(platform: Platform, unixPath: string, windowsPath?: string): string {
  if (platform === 'win32') return windowsPath ?? `%USERPROFILE%\\${unixPath.replace(/^~\//, '').replace(/\//g, '\\')}`
  return unixPath
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function vscodeCommand(definition: string, shell: Shell): string {
  if (shell === 'bash') return `code --add-mcp ${quote(definition, 'bash')}`
  if (shell === 'powershell') return `code --% --add-mcp ${windowsArgument(definition)}`
  return `code --add-mcp ${windowsArgument(definition)}`
}

export function buildClientSnippets(input: SnippetInput): ClientSnippet[] {
  const name = input.serverName ?? DEFAULT_SERVER_NAME
  const { url, token, shell, platform } = input
  const authorization = `Bearer ${token}`
  const headers = { Authorization: authorization }

  const desktopPath =
    platform === 'darwin'
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : platform === 'win32'
        ? '%APPDATA%\\Claude\\claude_desktop_config.json'
        : '~/.config/Claude/claude_desktop_config.json'

  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'command',
      content: [
        'claude mcp add --transport http --scope user',
        name,
        url,
        '--header',
        quote(`Authorization: ${authorization}`, shell)
      ].join(' ')
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      kind: 'config',
      path: homePath(platform, '~/.codex/config.toml'),
      note: 'merge',
      content: [
        `[mcp_servers.${name}]`,
        `url = ${JSON.stringify(url)}`,
        `http_headers = { "Authorization" = ${JSON.stringify(authorization)} }`
      ].join('\n')
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      kind: 'command',
      note: 'antigravity',
      content: [
        'gemini mcp add --scope user --transport http',
        name,
        url,
        '--header',
        quote(`Authorization: ${authorization}`, shell)
      ].join(' ')
    },
    {
      id: 'cursor',
      label: 'Cursor',
      kind: 'config',
      path: homePath(platform, '~/.cursor/mcp.json'),
      note: 'merge',
      content: json({ mcpServers: { [name]: { url, headers } } })
    },
    {
      id: 'vscode',
      label: 'VS Code (Copilot)',
      kind: 'command',
      content: vscodeCommand(JSON.stringify({ name, type: 'http', url, headers }), shell)
    },
    {
      id: 'copilot-cli',
      label: 'GitHub Copilot CLI',
      kind: 'config',
      path: homePath(platform, '~/.copilot/mcp-config.json'),
      note: 'merge',
      content: json({ mcpServers: { [name]: { type: 'http', url, headers, tools: ['*'] } } })
    },
    {
      id: 'opencode',
      label: 'opencode',
      kind: 'config',
      path: homePath(platform, '~/.config/opencode/opencode.json'),
      note: 'merge',
      content: json({
        $schema: 'https://opencode.ai/config.json',
        mcp: { servers: { [name]: { type: 'remote', url, oauth: false, headers } } }
      })
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'config',
      path: desktopPath,
      note: 'nodeRequired',
      content: json({
        mcpServers: {
          [name]: {
            command: 'npx',
            args: [
              '-y',
              'mcp-remote@latest',
              url,
              '--header',
              'Authorization:${AUTH_HEADER}',
              ...(url.startsWith('http://') ? ['--allow-http'] : [])
            ],
            env: { AUTH_HEADER: authorization }
          }
        }
      })
    },
    {
      id: 'generic',
      label: 'Other MCP clients',
      kind: 'config',
      content: json({ type: 'streamable-http', url, headers })
    }
  ]
}
