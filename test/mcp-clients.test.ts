import { describe, it, expect } from 'vitest'
import { buildClientSnippets, quote, type ClientId, type SnippetInput } from '../src/main/mcp/mcp-clients'

const base: SnippetInput = {
  url: 'http://127.0.0.1:8766/mcp',
  token: 'sge_abc123',
  shell: 'bash',
  platform: 'darwin'
}

const snippet = (id: ClientId, input: Partial<SnippetInput> = {}) =>
  buildClientSnippets({ ...base, ...input }).find((s) => s.id === id)!

describe('shell quoting', () => {
  it('survives a single quote in every shell', () => {
    expect(quote("it's", 'bash')).toBe(`'it'\\''s'`)
    expect(quote("it's", 'powershell')).toBe(`'it''s'`)
    expect(quote('say "hi"', 'cmd')).toBe('"say hi"')
  })
})

describe('client snippets', () => {
  it('registers Claude Code for every folder and keeps the variadic --header last', () => {
    const cmd = snippet('claude-code').content
    expect(cmd).toBe(
      "claude mcp add --transport http --scope user sincrogitexclude http://127.0.0.1:8766/mcp --header 'Authorization: Bearer sge_abc123'"
    )
  })

  it('uses double quotes for cmd and single quotes for PowerShell', () => {
    expect(snippet('claude-code', { shell: 'cmd' }).content).toContain('--header "Authorization: Bearer sge_abc123"')
    expect(snippet('claude-code', { shell: 'powershell' }).content).toContain("--header 'Authorization: Bearer sge_abc123'")
  })

  it('adds Gemini CLI at user scope, since its default is the current project', () => {
    expect(snippet('gemini').content).toMatch(/^gemini mcp add --scope user --transport http sincrogitexclude http:\/\/127\.0\.0\.1:8766\/mcp --header /)
  })

  it('gives Codex a TOML block with the token as a static header', () => {
    const codex = snippet('codex')
    expect(codex.path).toBe('~/.codex/config.toml')
    expect(codex.content).toBe(
      '[mcp_servers.sincrogitexclude]\nurl = "http://127.0.0.1:8766/mcp"\nhttp_headers = { "Authorization" = "Bearer sge_abc123" }'
    )
  })

  it('passes VS Code a JSON argument it can parse in each shell', () => {
    const bash = snippet('vscode').content
    expect(JSON.parse(bash.replace(/^code --add-mcp '/, '').replace(/'$/, ''))).toEqual({
      name: 'sincrogitexclude',
      type: 'http',
      url: base.url,
      headers: { Authorization: 'Bearer sge_abc123' }
    })
    const ps = snippet('vscode', { shell: 'powershell', platform: 'win32' }).content
    expect(ps.startsWith('code --% --add-mcp "{\\"name\\":')).toBe(true)
    const cmd = snippet('vscode', { shell: 'cmd', platform: 'win32' }).content
    expect(cmd.startsWith('code --add-mcp "{\\"name\\":')).toBe(true)
  })

  it('produces valid JSON for every file-based client', () => {
    for (const id of ['cursor', 'copilot-cli', 'opencode', 'claude-desktop', 'generic'] as ClientId[]) {
      expect(() => JSON.parse(snippet(id).content)).not.toThrow()
    }
    expect(JSON.parse(snippet('opencode').content).mcp.servers.sincrogitexclude).toEqual({
      type: 'remote',
      url: base.url,
      oauth: false,
      headers: { Authorization: 'Bearer sge_abc123' }
    })
  })

  it('keeps spaces out of Claude Desktop args, which Windows does not escape', () => {
    const config = JSON.parse(snippet('claude-desktop', { platform: 'win32' }).content).mcpServers.sincrogitexclude
    expect(config.args.every((a: string) => !a.includes(' '))).toBe(true)
    expect(config.args).toContain('Authorization:${AUTH_HEADER}')
    expect(config.args).toContain('--allow-http')
    expect(config.env.AUTH_HEADER).toBe('Bearer sge_abc123')
    expect(snippet('claude-desktop', { platform: 'win32' }).path).toBe('%APPDATA%\\Claude\\claude_desktop_config.json')
  })

  it('points config files at the user profile on Windows', () => {
    expect(snippet('cursor', { platform: 'win32' }).path).toBe('%USERPROFILE%\\.cursor\\mcp.json')
    expect(snippet('opencode', { platform: 'linux' }).path).toBe('~/.config/opencode/opencode.json')
  })
})
