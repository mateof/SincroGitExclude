import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { createFixture, git, writeFile, type Fixture } from './helpers/git-fixture'
import { cloneSpace, emptyReport, ensureRepo, noteDiff, syncGitSpace } from '../src/main/kb/sync/git-space'
import { commitDetail, gitOverview, listCommits, pendingFiles } from '../src/main/kb/sync/git-insight'
import { capReport, logAction, LOG_FILES_PER_LIST, totalsOf } from '../src/main/kb/sync/sync-log'
import { remoteLinks, safeRemoteLinks } from '../src/shared/kb/git-remote'
import type { KbSyncReport } from '../src/shared/kb/types'

let fx: Fixture
let remote: string
let mac: string
let win: string

const opts = (machineName: string) => ({ branch: 'main', machineName, blockSecrets: true })

beforeEach(async () => {
  fx = createFixture()
  remote = join(fx.root, 'remote.git')
  mac = join(fx.root, 'mac')
  win = join(fx.root, 'win')
  mkdirSync(remote, { recursive: true })
  await git(remote, 'init', '-q', '--bare', '-b', 'main')
  mkdirSync(mac, { recursive: true })
  writeFile(mac, 'projects/app.md', '# App\n')
  writeFile(mac, 'inbox/vieja.md', '# Vieja\n')
  await ensureRepo(mac, remote, 'main', [], { name: 'Ana', email: 'ana@example.com' })
})

afterEach(() => fx.cleanup())

describe('what a git sync reports', () => {
  it('lists deleted notes apart from sent and received ones, on both computers', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    rmSync(join(mac, 'inbox/vieja.md'))
    writeFile(mac, 'projects/app.md', '# App cambiada\n')
    const sent = await syncGitSpace(mac, opts('mac'))
    expect(sent.pushed).toEqual(['projects/app.md'])
    expect(sent.deletedRemote).toEqual(['inbox/vieja.md'])
    const received = await syncGitSpace(win, opts('win'))
    expect(received.pulled).toEqual(['projects/app.md'])
    expect(received.deletedLocal).toEqual(['inbox/vieja.md'])
  })

  it('reports both paths of a moved note', async () => {
    await syncGitSpace(mac, opts('mac'))
    await git(mac, 'mv', 'inbox/vieja.md', 'projects/vieja.md')
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.pushed).toEqual(['projects/vieja.md'])
    expect(report.deletedRemote).toEqual(['inbox/vieja.md'])
  })

  it('does not say a note was deleted here when the local edit kept it', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    rmSync(join(win, 'inbox/vieja.md'))
    await syncGitSpace(win, opts('win'))
    writeFile(mac, 'inbox/vieja.md', '# Vieja editada\n')
    const report = await syncGitSpace(mac, opts('mac'))
    expect(existsSync(join(mac, 'inbox/vieja.md'))).toBe(true)
    expect(report.deletedLocal).toEqual([])
  })

  it('counts the commits that travelled each way', async () => {
    expect((await syncGitSpace(mac, opts('mac'))).commitsPushed).toBe(1)
    await cloneSpace(remote, win, 'main')
    for (const n of [1, 2]) {
      writeFile(win, `n${n}.md`, 'x\n')
      await syncGitSpace(win, opts('win'))
    }
    const report = await syncGitSpace(mac, opts('mac'))
    expect(report.commitsPulled).toBe(2)
    expect(report.commitsPushed).toBeUndefined()
  })
})

describe('git overview of a space', () => {
  it('has no commits before the first sync but already lists what is waiting', async () => {
    const overview = await gitOverview(mac, 'main', remote)
    expect(overview.head).toBeNull()
    expect(overview.ahead).toBe(0)
    expect(overview.pending.map((f) => f.path)).toContain('projects/app.md')
  })

  it('shows the last commit with its author and files, and whether it was sent', async () => {
    await syncGitSpace(mac, opts('mac'))
    const { head, ahead, behind, pendingCount, commits } = await gitOverview(mac, 'main', remote)
    expect(head).toMatchObject({ author: 'Ana', email: 'ana@example.com', subject: 'Update notes (mac)', pushed: true, merge: false })
    expect(head?.files).toContainEqual({ path: 'projects/app.md', status: 'added' })
    expect({ ahead, behind, pendingCount, commits }).toEqual({ ahead: 0, behind: 0, pendingCount: 0, commits: 1 })
  })

  it('counts commits still to send, commits fetched but not merged, and uncommitted files', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'win.md', 'w\n')
    await syncGitSpace(win, opts('win'))
    await git(mac, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    writeFile(mac, 'mac.md', 'm\n')
    await git(mac, 'add', '-A')
    await git(mac, 'commit', '-q', '-m', 'local')
    await git(mac, 'commit', '-q', '--allow-empty', '-m', 'local 2')
    writeFile(mac, 'carpeta con espacios/ñandú.md', 'n\n')
    rmSync(join(mac, 'inbox/vieja.md'))
    const overview = await gitOverview(mac, 'main', remote)
    expect({ ahead: overview.ahead, behind: overview.behind }).toEqual({ ahead: 2, behind: 1 })
    expect(overview.head?.pushed).toBe(false)
    expect(overview.pending).toContainEqual({ path: 'carpeta con espacios/ñandú.md', status: 'added' })
    expect(overview.pending).toContainEqual({ path: 'inbox/vieja.md', status: 'deleted' })
  })

  it('reads the state while a sync holds the index lock', async () => {
    await syncGitSpace(mac, opts('mac'))
    writeFile(mac, '.git/index.lock', '')
    writeFile(mac, 'nueva.md', 'n\n')
    expect(await pendingFiles(mac)).toEqual([{ path: 'nueva.md', status: 'added' }])
  })
})

describe('commits of a space', () => {
  it('pages through the commits and keeps strange file names whole', async () => {
    for (const name of ['uno.md', 'con "comillas".md', 'año nuevo.md']) {
      writeFile(mac, name, 'x\n')
      await syncGitSpace(mac, opts('mac'))
    }
    const all = await listCommits(mac, 'main', 10)
    expect(all).toHaveLength(3)
    expect(all[0].files).toEqual([{ path: 'año nuevo.md', status: 'added' }])
    expect(all[1].files).toEqual([{ path: 'con "comillas".md', status: 'added' }])
    expect((await listCommits(mac, 'main', 1, 1))[0].hash).toBe(all[1].hash)
  })

  it('counts every file of a big commit but lists only the first ones', async () => {
    for (let i = 0; i < 30; i++) writeFile(mac, `n${i}.md`, 'x\n')
    await syncGitSpace(mac, opts('mac'))
    const [commit] = await listCommits(mac, 'main')
    expect(commit.files).toHaveLength(20)
    expect(commit.fileCount).toBe(33)
    expect((await commitDetail(mac, 'main', commit.hash)).files).toHaveLength(33)
  })

  it('details a commit with the lines each file gained and lost', async () => {
    await syncGitSpace(mac, opts('mac'))
    writeFile(mac, 'projects/app.md', '# App\n\nuno\ndos\n')
    writeFile(mac, 'img.bin', Buffer.from([0, 1, 2, 0]))
    await syncGitSpace(mac, opts('mac'))
    const [commit] = await listCommits(mac, 'main', 1)
    const detail = await commitDetail(mac, 'main', commit.hash)
    expect(detail.files).toContainEqual({ path: 'projects/app.md', status: 'modified', added: 3, removed: 0 })
    expect(detail.files).toContainEqual({ path: 'img.bin', status: 'added', added: null, removed: null })
  })

  it('details the first commit, which has no parent', async () => {
    await syncGitSpace(mac, opts('mac'))
    const [first] = await listCommits(mac, 'main')
    expect((await commitDetail(mac, 'main', first.hash)).files.map((f) => f.path)).toContain('projects/app.md')
  })

  it('shows in a merge what it brought here, in the list of files and in each diff', async () => {
    await syncGitSpace(mac, opts('mac'))
    await cloneSpace(remote, win, 'main')
    writeFile(win, 'win.md', 'desde win\n')
    await syncGitSpace(win, opts('win'))
    writeFile(mac, 'mac.md', 'm\n')
    await syncGitSpace(mac, opts('mac'))
    const [merge] = await listCommits(mac, 'main', 1)
    expect(merge.merge).toBe(true)
    expect((await commitDetail(mac, 'main', merge.hash)).files.map((f) => f.path)).toEqual(['win.md'])
    expect(await noteDiff(mac, merge.hash, 'win.md')).toContain('+desde win')
  })

  it('refuses anything that is not a commit hash', async () => {
    await syncGitSpace(mac, opts('mac'))
    await expect(commitDetail(mac, 'main', '--output=/tmp/x')).rejects.toThrow('Invalid commit')
    await expect(commitDetail(mac, 'main', 'HEAD')).rejects.toThrow('Invalid commit')
    await expect(commitDetail(mac, 'main', 'abcdef1234')).rejects.toThrow('Commit not found')
  })
})

describe('log of syncs', () => {
  const report = (over: Partial<KbSyncReport> = {}): KbSyncReport => ({ ...emptyReport(), ...over })
  const offline = report({ ok: false, message: 'fetch failed: no network' })

  it('keeps the syncs that moved something and skips the idle ones', () => {
    expect(logAction(null, report({ pulled: ['a.md'] }))).toBe('insert')
    expect(logAction(null, report({ deletedRemote: ['a.md'] }))).toBe('insert')
    expect(logAction(null, report())).toBe('skip')
    expect(logAction(report({ pulled: ['a.md'] }), report())).toBe('skip')
  })

  it('counts a repeated problem in one entry and starts another when it changes', () => {
    expect(logAction(null, offline)).toBe('insert')
    expect(logAction(offline, offline)).toBe('repeat')
    expect(logAction(offline, report({ ok: false, message: 'push failed' }))).toBe('insert')
    expect(logAction(offline, report({ blockedBy: 'review' }))).toBe('insert')
    expect(logAction(report({ blockedBy: 'review', message: 'wait' }), report({ blockedBy: 'locked', message: 'wait' }))).toBe('insert')
  })

  it('never adds a repetition to a sync that moved files', () => {
    const partial = report({ pulled: ['a.md'], blockedBy: 'review', message: 'wait' })
    expect(logAction(partial, report({ blockedBy: 'review', message: 'wait' }))).toBe('insert')
  })

  it('notes that it works again after a problem', () => {
    expect(logAction(offline, report())).toBe('insert')
  })

  it('stores a limited list of files with the real totals', () => {
    const many = report({ pushed: Array.from({ length: LOG_FILES_PER_LIST + 50 }, (_, i) => `n${i}.md`) })
    expect(capReport(many).pushed).toHaveLength(LOG_FILES_PER_LIST)
    expect(totalsOf(many).pushed).toBe(LOG_FILES_PER_LIST + 50)
    expect(many.pushed).toHaveLength(LOG_FILES_PER_LIST + 50)
  })
})

describe('links to the repository on the web', () => {
  it('links repository and commits of each provider without credentials', () => {
    expect(remoteLinks('https://ana@gitea.example.com/ana/notas.git')).toEqual({
      label: 'gitea.example.com/ana/notas',
      provider: 'gitea',
      repoUrl: 'https://gitea.example.com/ana/notas',
      commitBase: 'https://gitea.example.com/ana/notas/commit/'
    })
    expect(remoteLinks('https://gitlab.example.com/g/s/notas.git').commitBase).toBe('https://gitlab.example.com/g/s/notas/-/commit/')
    expect(remoteLinks('git@github.com:ana/notas.git').commitBase).toBe('https://github.com/ana/notas/commit/')
    expect(remoteLinks('ssh://git@gitea.example.com:2222/ana/notas.git').repoUrl).toBe('https://gitea.example.com/ana/notas')
  })

  it('does not guess the web address of an unknown server', () => {
    expect(remoteLinks('https://git.example.com/ana/notas.git')).toMatchObject({ repoUrl: 'https://git.example.com/ana/notas', commitBase: null })
    expect(remoteLinks('ssh://git@nas.local:2222/ana/notas.git')).toEqual({ label: 'nas.local/ana/notas', provider: 'other', repoUrl: null, commitBase: null })
    expect(remoteLinks('/Volumes/nas/notas.git')).toEqual({ label: '/Volumes/nas/notas.git', provider: 'other', repoUrl: null, commitBase: null })
  })

  it('offers no link when the remote is missing or not valid', () => {
    expect(safeRemoteLinks(undefined)).toBeNull()
    expect(safeRemoteLinks('')).toBeNull()
    expect(safeRemoteLinks('https://ana:token@example.com/notas.git')).toBeNull()
    expect(safeRemoteLinks('javascript://example.com/%0aalert(1)')).toBeNull()
  })
})
