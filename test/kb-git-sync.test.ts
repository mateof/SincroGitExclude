import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createFixture, git, writeFile, type Fixture } from './helpers/git-fixture'
import {
  cloneSpace,
  commitAll,
  conflictCopyName,
  ensureRepo,
  noteAt,
  noteHistory,
  syncGitSpace
} from '../src/main/kb/sync/git-space'
import { scanText } from '../src/main/kb/secrets/scanner'

let fx: Fixture
let remote: string
let mac: string
let win: string

const opts = (machineName: string) => ({ branch: 'main', machineName, blockSecrets: true })

beforeEach(async () => {
  fx = createFixture()
  remote = join(fx.root, 'remote.git')
  mac = join(fx.root, 'mac', 'vault')
  win = join(fx.root, 'win', 'vault')
  mkdirSync(remote, { recursive: true })
  await git(remote, 'init', '-q', '--bare', '-b', 'main')
  mkdirSync(mac, { recursive: true })
  writeFile(mac, 'projects/app.md', '# App\n\nEstado inicial\n')
  writeFile(mac, '.obsidian/workspace.json', '{"open":1}')
  await ensureRepo(mac, remote, 'main')
})

afterEach(() => fx.cleanup())

describe('git sync of a knowledge space', () => {
  it('pushes the first version without the volatile Obsidian files', async () => {
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.ok).toBe(true)
    expect(report.pushed).toContain('projects/app.md')
    expect(report.pushed).not.toContain('.obsidian/workspace.json')
    const files = await git(remote, 'ls-tree', '-r', '--name-only', 'main')
    expect(files.split('\n')).toEqual(['.gitignore', 'projects/app.md'])
  })

  it('brings notes written on another machine and reports them as pulled', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'decisions/nueva.md', '# Nueva\n')
    expect((await syncGitSpace(win, opts('win'))).pushed).toEqual(['decisions/nueva.md'])
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.pulled).toEqual(['decisions/nueva.md'])
    expect(readFileSync(join(mac, 'decisions/nueva.md'), 'utf-8')).toBe('# Nueva\n')
  })

  it('syncs a cloned space on a computer without a git identity', async () => {
    await syncGitSpace(mac, opts('mac'))
    writeFileSync(fx.globalConfig, '[user]\n\tuseConfigOnly = true\n')
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'decisions/nueva.md', '# Nueva\n')
    const report = await syncGitSpace(win, opts('win'))
    expect(report.ok).toBe(true)
    expect(report.pushed).toEqual(['decisions/nueva.md'])
  })

  it('merges edits to different parts of the same note without conflict', async () => {
    writeFile(mac, 'projects/app.md', '# App\n\nEstado inicial\n\n## A\n\nuno\n\n## B\n\ndos\n')
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'projects/app.md', '# App\n\nEstado inicial\n\n## A\n\nuno\n\n## B\n\ndos cambiado en win\n')
    await syncGitSpace(win, opts('win'))
    writeFile(mac, 'projects/app.md', '# App\n\nEstado cambiado en mac\n\n## A\n\nuno\n\n## B\n\ndos\n')
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.conflicts).toEqual([])
    expect(readFileSync(join(mac, 'projects/app.md'), 'utf-8')).toContain('cambiado en mac')
    expect(readFileSync(join(mac, 'projects/app.md'), 'utf-8')).toContain('cambiado en win')
  })

  it('keeps both versions when the same lines changed: remote in place, local as a conflict copy', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'projects/app.md', '# App\n\nEstado de win\n')
    await syncGitSpace(win, opts('win'))
    writeFile(mac, 'projects/app.md', '# App\n\nEstado de mac\n')
    const report = await syncGitSpace(mac, { ...opts('mac'), now: () => new Date(2026, 10, 23, 9, 5) })
    expect(report.conflicts).toEqual(['projects/app (conflict mac 2026-11-23 0905).md'])
    expect(readFileSync(join(mac, 'projects/app.md'), 'utf-8')).toBe('# App\n\nEstado de win\n')
    expect(readFileSync(join(mac, 'projects', 'app (conflict mac 2026-11-23 0905).md'), 'utf-8')).toBe(
      '# App\n\nEstado de mac\n'
    )
    expect(report.ok).toBe(true)
    const back = await syncGitSpace(win, opts('win'))
    expect(back.pulled).toContain('projects/app (conflict mac 2026-11-23 0905).md')
  })

  it('keeps a note edited here even if another machine deleted it', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    await git(win, 'rm', '-q', 'projects/app.md')
    await git(win, 'commit', '-q', '-m', 'delete')
    await syncGitSpace(win, opts('win'))
    writeFile(mac, 'projects/app.md', '# App\n\nEditada mientras se borraba\n')
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.ok).toBe(true)
    expect(existsSync(join(mac, 'projects/app.md'))).toBe(true)
  })

  it('never forces: when another machine pushed first it merges and keeps both commits', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'win.md', 'w\n')
    await commitAll(win, 'win')
    await git(win, 'push', '-q', 'origin', 'HEAD:main')
    writeFile(mac, 'mac.md', 'm\n')
    await commitAll(mac, 'mac')
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.ok).toBe(true)
    expect(await git(remote, 'show', 'main:win.md')).toBe('w')
    expect(await git(remote, 'show', 'main:mac.md')).toBe('m')
  })

  it('blocks the push when an outgoing note contains a token', async () => {
    writeFile(mac, 'inbox/creds.md', 'Authorization: Bearer 78bedb7671044b5ba0e19313fd96c191\n')
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.blockedBy).toBe('secrets')
    expect(report.secrets).toEqual([{ path: 'inbox/creds.md', rule: 'bearer-token', line: 1 }])
    expect(await git(remote, 'rev-parse', '--verify', '-q', 'main').catch(() => 'none')).toBe('none')
  })

  it('stops before pushing when the review gate says so, but still pulls', async () => {
    const report = await syncGitSpace(mac, {
      ...opts('mac'),
      allowPush: () => ({ ok: false, reason: 'review', message: 'pending review' })
    })
    expect(report.blockedBy).toBe('review')
    expect(readdirSync(join(remote, 'refs', 'heads'))).toEqual([])
  })

  it('excludes nested spaces from the parent repository', async () => {
    writeFile(mac, 'team/shared.md', '# Shared\n')
    await ensureRepo(mac, remote, 'main', ['team'])
    await syncGitSpace(mac, opts('mac'))
    const files = await git(remote, 'ls-tree', '-r', '--name-only', 'main')
    expect(files).not.toContain('team/shared.md')
  })

  it('reads the history of a note and its content at a commit', async () => {
    await syncGitSpace(mac, opts('mac'))
    writeFile(mac, 'projects/app.md', '# App\n\nSegunda versión\n')
    await syncGitSpace(mac, opts('mac'))
    const history = await noteHistory(mac, 'projects/app.md')
    expect(history).toHaveLength(2)
    expect(await noteAt(mac, history[1].hash, 'projects/app.md')).toBe('# App\n\nEstado inicial\n')
  })
})

describe('conflict copy names and secret scanning', () => {
  it('names conflict copies next to the note, safe for every file system', () => {
    expect(conflictCopyName('a/b/nota.md', 'MacBook: Pro', new Date(2026, 0, 2, 3, 4))).toBe(
      'a/b/nota (conflict MacBook- Pro 2026-01-02 0304).md'
    )
  })

  it('finds real looking tokens and ignores placeholders and marked lines', () => {
    expect(scanText('token: ghp_' + 'a'.repeat(36)).map((f) => f.rule)).toEqual(['github-token'])
    expect(scanText('password: ${DB_PASSWORD}')).toEqual([])
    expect(scanText('  PASSWORD="$(read_keystore_password)"')).toEqual([])
    expect(scanText('api_key = "<your key here>"')).toEqual([])
    expect(scanText('api_key = sk-ant-' + 'b'.repeat(30) + ' sge-kb:allow-secret')).toEqual([])
    expect(scanText('-----BEGIN OPENSSH PRIVATE KEY-----')[0].rule).toBe('private-key')
    expect(scanText('Usa el token del MCP, nunca lo copies aquí.')).toEqual([])
  })
})
