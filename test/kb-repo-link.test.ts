import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { applyLink, planLink, removeLink, sessionHookCommand, readPointer, type LinkTarget } from '../src/main/kb/repo-link/pointer'
import { normalizeRemoteUrl, readRegistry, removeFromRegistry, upsertRegistry } from '../src/main/kb/repo-link/registry'
import { createFixture, git, writeFile, type Fixture } from './helpers/git-fixture'

let fx: Fixture
let repo: string

const ALL = { pointer: true, mcpJson: true, sessionHook: true, agentsMd: true }

function target(overrides: Partial<LinkTarget> = {}): LinkTarget {
  return {
    repoPath: repo,
    spaceId: 'space-1',
    spaceName: 'Personal',
    vaultPath: '/Users/me/vaults/claude',
    notePath: 'projects/app.md',
    noteAbsolutePath: "/Users/me/vaults/claude/projects/app's.md",
    mcpUrl: 'http://127.0.0.1:8766/mcp',
    localVault: true,
    userLevelMcp: false,
    integrations: ALL,
    ...overrides
  }
}

const read = (rel: string): string => readFileSync(join(repo, rel), 'utf-8')

beforeEach(async () => {
  fx = createFixture()
  repo = join(fx.root, 'app')
  mkdirSync(repo, { recursive: true })
  await git(repo, 'init', '-q', '-b', 'main')
  await git(repo, 'config', 'user.name', 'T')
  await git(repo, 'config', 'user.email', 't@local')
  writeFile(repo, 'README.md', '# App\n')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-q', '-m', 'init')
})

afterEach(() => fx.cleanup())

describe('linking a repository to its note', () => {
  it('creates the four files, all hidden from git without touching .gitignore', async () => {
    const { plan } = await applyLink(target(), null)
    expect(plan.map((p) => [p.file, p.action])).toEqual([
      ['.sge-kb.json', 'create'],
      ['.mcp.json', 'create'],
      ['.claude/settings.local.json', 'create'],
      ['AGENTS.md', 'create']
    ])
    expect(await git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(existsSync(join(repo, '.gitignore'))).toBe(false)
    expect(readPointer(repo)).toEqual({ spaceId: 'space-1', note: 'projects/app.md' })
    expect(JSON.parse(read('.mcp.json')).mcpServers['sincrogitexclude-kb'].headers.Authorization).toBe(
      'Bearer ${SGE_KB_TOKEN}'
    )
  })

  it('is idempotent: linking twice changes nothing and keeps one hook', async () => {
    const first = await applyLink(target(), null)
    const second = await applyLink(target(), first.state)
    expect(second.plan.every((p) => p.action === 'skip')).toBe(true)
    expect(JSON.parse(read('.claude/settings.local.json')).hooks.SessionStart).toHaveLength(1)
  })

  it('merges with existing local settings and keeps the user hooks', async () => {
    writeFile(
      repo,
      '.claude/settings.local.json',
      JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } })
    )
    const { state } = await applyLink(target(), null)
    const parsed = JSON.parse(read('.claude/settings.local.json'))
    expect(parsed.permissions.allow).toEqual(['Bash(ls)'])
    expect(parsed.hooks.SessionStart).toHaveLength(2)
    await removeLink(repo, state)
    const after = JSON.parse(read('.claude/settings.local.json'))
    expect(after).toEqual({ permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } })
  })

  it('leaves tracked files alone, e.g. a team AGENTS.md', async () => {
    writeFile(repo, 'AGENTS.md', '# Team rules\n')
    await git(repo, 'add', 'AGENTS.md')
    await git(repo, 'commit', '-q', '-m', 'agents')
    const plan = await planLink(target())
    expect(plan.items.find((i) => i.file === 'AGENTS.md')).toMatchObject({ action: 'skip' })
    await applyLink(target(), null)
    expect(read('AGENTS.md')).toBe('# Team rules\n')
  })

  it('skips .mcp.json when the MCP is already configured for the user', async () => {
    const plan = await planLink(target({ userLevelMcp: true }))
    expect(plan.items.find((i) => i.file === '.mcp.json')).toMatchObject({ action: 'skip' })
  })

  it('adds its block to an untracked AGENTS.md and removes only that block on unlink', async () => {
    writeFile(repo, 'AGENTS.md', '# My local notes\n')
    const { state } = await applyLink(target(), null)
    expect(read('AGENTS.md')).toContain('<!-- sge-kb:start -->')
    expect(read('AGENTS.md')).toContain('# My local notes')
    await removeLink(repo, state)
    expect(read('AGENTS.md')).toBe('# My local notes\n')
  })

  it('unlinking removes the files it created and their exclude entries', async () => {
    const { state } = await applyLink(target(), null)
    await removeLink(repo, state)
    for (const f of ['.sge-kb.json', '.mcp.json', '.claude/settings.local.json', 'AGENTS.md']) {
      expect(existsSync(join(repo, f))).toBe(false)
    }
    expect(existsSync(join(repo, '.claude'))).toBe(false)
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf-8')).not.toContain('.sge-kb.json')
  })

  it('works in a linked worktree, whose .git is a file', async () => {
    const linked = join(fx.root, 'app-feature')
    await git(repo, 'worktree', 'add', '-q', '-b', 'feature', linked)
    await applyLink(target({ repoPath: linked }), null)
    expect(await git(linked, 'status', '--porcelain', '--untracked-files=all')).toBe('')
  })

  it('builds a hook that prints the note even with quotes in the path, and a remote variant', () => {
    expect(sessionHookCommand(target())).toContain(`cat '/Users/me/vaults/claude/projects/app'\\''s.md' 2>/dev/null || true`)
    const remote = sessionHookCommand(target({ localVault: false, mcpUrl: 'http://100.64.0.2:8766/mcp' }))
    expect(remote).toContain('curl -fsS -H "Authorization: Bearer $SGE_KB_TOKEN"')
    expect(remote).toContain('http://100.64.0.2:8766/kb/context?space=space-1&note=projects%2Fapp.md')
  })
})

describe('registry of linked repositories', () => {
  it('normalizes ssh, scp-like and https remotes to the same key', () => {
    const keys = [
      'git@192.168.0.22:mateo/App.git',
      'ssh://git@192.168.0.22:2222/mateo/app.git',
      'https://user@192.168.0.22/mateo/app',
      'http://192.168.0.22:21080/mateo/app.git/'
    ].map(normalizeRemoteUrl)
    expect(new Set(keys)).toEqual(new Set(['192.168.0.22/mateo/app']))
    expect(normalizeRemoteUrl('/local/path')).toBeNull()
  })

  it('stores, replaces and removes entries inside the space', () => {
    const space = join(fx.root, 'vault')
    mkdirSync(space)
    upsertRegistry(space, { remote: 'h/a', note: 'projects/a.md', name: 'a' })
    upsertRegistry(space, { remote: 'h/a', note: 'projects/a2.md', name: 'a' })
    expect(readRegistry(space)).toEqual([{ remote: 'h/a', note: 'projects/a2.md', name: 'a' }])
    removeFromRegistry(space, 'h/a')
    expect(readRegistry(space)).toEqual([])
  })
})
