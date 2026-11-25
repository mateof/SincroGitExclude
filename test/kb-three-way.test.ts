import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { syncThreeWay, type SyncState } from '../src/main/kb/sync/three-way'
import { FsStore } from '../src/main/kb/sync/fs-store'
import { LOCK_FILE, RemoteLockedError } from '../src/main/kb/sync/remote-store'

let base: string
let remote: string
let mac: string
let win: string
let macState: SyncState
let winState: SyncState

function put(root: string, rel: string, content: string): void {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf-8')

async function syncMac(extra: Partial<Parameters<typeof syncThreeWay>[3]> = {}) {
  const result = await syncThreeWay(mac, new FsStore(remote, 'mac'), macState, {
    machineName: 'mac',
    blockSecrets: true,
    now: () => new Date(2026, 10, 23, 10, 0),
    ...extra
  })
  macState = result.state
  return result.report
}

async function syncWin() {
  const result = await syncThreeWay(win, new FsStore(remote, 'win'), winState, {
    machineName: 'win',
    blockSecrets: true,
    now: () => new Date(2026, 10, 23, 10, 0)
  })
  winState = result.state
  return result.report
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sge-3w-'))
  remote = join(base, 'nas')
  mac = join(base, 'mac')
  win = join(base, 'win')
  for (const d of [remote, mac, win]) mkdirSync(d, { recursive: true })
  macState = new Map()
  winState = new Map()
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('three-way sync over a folder', () => {
  it('uploads, then another machine downloads, skipping volatile and trash files', async () => {
    put(mac, 'projects/app.md', '# App\n')
    put(mac, '.obsidian/app.json', '{}')
    put(mac, '.obsidian/workspace.json', '{"x":1}')
    put(mac, '.trash/old.md', 'old')
    const up = await syncMac()
    expect(up.pushed.sort()).toEqual(['.obsidian/app.json', 'projects/app.md'])
    const down = await syncWin()
    expect(down.pulled.sort()).toEqual(['.obsidian/app.json', 'projects/app.md'])
    expect(existsSync(join(win, '.obsidian/workspace.json'))).toBe(false)
  })

  it('does nothing on a second run and does not re-read unchanged remote files', async () => {
    put(mac, 'a.md', 'a')
    await syncMac()
    const again = await syncMac()
    expect([again.pushed, again.pulled]).toEqual([[], []])
  })

  it('propagates an edit and a deletion, moving the local copy to .trash', async () => {
    put(mac, 'a.md', 'one')
    put(mac, 'b.md', 'bee')
    await syncMac()
    await syncWin()
    put(win, 'a.md', 'two')
    unlinkSync(join(win, 'b.md'))
    const winReport = await syncWin()
    expect(winReport.pushed).toEqual(['a.md'])
    expect(winReport.deletedRemote).toEqual(['b.md'])
    const macReport = await syncMac()
    expect(macReport.pulled).toEqual(['a.md'])
    expect(macReport.deletedLocal).toEqual(['b.md'])
    expect(read(mac, 'a.md')).toBe('two')
    expect(read(mac, '.trash/b.md')).toBe('bee')
  })

  it('keeps both versions on a real conflict and shares the copy', async () => {
    put(mac, 'a.md', 'base')
    await syncMac()
    await syncWin()
    put(win, 'a.md', 'win version')
    await syncWin()
    put(mac, 'a.md', 'mac version')
    const report = await syncMac()
    expect(report.conflicts).toEqual(['a (conflict mac 2026-11-23 1000).md'])
    expect(read(mac, 'a.md')).toBe('win version')
    expect(read(mac, 'a (conflict mac 2026-11-23 1000).md')).toBe('mac version')
    expect((await syncWin()).pulled).toEqual(['a (conflict mac 2026-11-23 1000).md'])
  })

  it('treats identical edits on both sides as already in sync', async () => {
    put(mac, 'a.md', 'base')
    await syncMac()
    await syncWin()
    put(mac, 'a.md', 'same')
    put(win, 'a.md', 'same')
    await syncWin()
    const report = await syncMac()
    expect(report.conflicts).toEqual([])
    expect(report.pulled).toEqual([])
  })

  it('keeps a file edited here that another machine deleted', async () => {
    put(mac, 'a.md', 'base')
    await syncMac()
    await syncWin()
    unlinkSync(join(win, 'a.md'))
    await syncWin()
    put(mac, 'a.md', 'edited')
    const report = await syncMac()
    expect(report.pushed).toEqual(['a.md'])
    expect(read(remote, 'a.md')).toBe('edited')
  })

  it('notices a remote edit even when size and mtime were restored', async () => {
    put(mac, 'a.md', 'aaaa')
    await syncMac()
    const stamp = new Date(2026, 0, 1)
    writeFileSync(join(remote, 'a.md'), 'bbbb')
    utimesSync(join(remote, 'a.md'), stamp, stamp)
    const entry = macState.get('a.md')!
    macState.set('a.md', { ...entry, remoteMtime: Math.floor(stamp.getTime()) - 1 })
    expect((await syncMac()).pulled).toEqual(['a.md'])
  })

  it('refuses to delete most of the remote when the local folder looks empty', async () => {
    for (let i = 0; i < 12; i++) put(mac, `n${i}.md`, `${i}`)
    await syncMac()
    for (let i = 0; i < 12; i++) unlinkSync(join(mac, `n${i}.md`))
    const report = await syncMac()
    expect(report.ok).toBe(false)
    expect(report.message).toMatch(/would delete 12 of 12 files on the remote/)
    expect(existsSync(join(remote, 'n0.md'))).toBe(true)
  })

  it('blocks uploads with secrets but still downloads', async () => {
    put(win, 'remote.md', 'from win')
    await syncWin()
    put(mac, 'creds.md', 'token: glpat-abcdefghijklmnopqrstuvwxyz\n')
    const report = await syncMac()
    expect(report.blockedBy).toBe('secrets')
    expect(report.pulled).toEqual(['remote.md'])
    expect(existsSync(join(remote, 'creds.md'))).toBe(false)
  })

  it('refuses to run while another machine holds a live lock, and cleans its own lock', async () => {
    writeFileSync(
      join(remote, LOCK_FILE),
      JSON.stringify({ holder: 'win', token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    )
    await expect(syncMac()).rejects.toBeInstanceOf(RemoteLockedError)
    writeFileSync(
      join(remote, LOCK_FILE),
      JSON.stringify({ holder: 'win', token: 't', expiresAt: new Date(Date.now() - 1).toISOString() })
    )
    put(mac, 'a.md', 'a')
    await syncMac()
    expect(existsSync(join(remote, LOCK_FILE))).toBe(false)
  })

  it('leaves nested spaces to their own sync', async () => {
    put(mac, 'team/shared.md', 'x')
    put(mac, 'mine.md', 'y')
    const report = await syncMac({ childDirs: ['team'] })
    expect(report.pushed).toEqual(['mine.md'])
  })
})
