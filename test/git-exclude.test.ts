import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, symlinkSync, existsSync } from 'fs'
import { join } from 'path'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { GitExcludeService } from '../src/main/git/git-exclude'
import { isCloudSyncedPath } from '../src/main/utils/errors'
import { createFixture, git, writeFile, type Fixture } from './helpers/git-fixture'

let fx: Fixture

beforeEach(() => {
  fx = createFixture()
})

afterEach(() => fx.cleanup())

async function initRepo(path: string): Promise<void> {
  mkdirSync(path, { recursive: true })
  await git(path, 'init', '-q', '-b', 'main')
  await git(path, 'config', 'user.name', 'Test')
  await git(path, 'config', 'user.email', 'test@local')
  writeFile(path, 'README.md', 'hello\n')
  await git(path, 'add', '-A')
  await git(path, 'commit', '-q', '-m', 'initial')
}

describe('GitExcludeService in linked worktrees', () => {
  it('writes the exclusion to the shared info/exclude when .git is a file', async () => {
    const main = join(fx.root, 'main')
    const linked = join(fx.root, 'linked')
    await initRepo(main)
    await git(main, 'worktree', 'add', '-q', '-b', 'feature', linked)

    const service = new GitExcludeService()
    await service.addExclusion(linked, '.sge-kb.json')
    writeFile(linked, '.sge-kb.json', '{}')

    expect(readFileSync(join(main, '.git', 'info', 'exclude'), 'utf-8')).toContain('.sge-kb.json')
    expect(await git(linked, 'status', '--porcelain')).toBe('')
    expect(await service.isExcluded(linked, '.sge-kb.json')).toBe(true)
  })

  it('keeps using .git/info/exclude in a normal repository', async () => {
    const repo = join(fx.root, 'repo')
    await initRepo(repo)
    const service = new GitExcludeService()
    expect(service.getExcludePath(repo)).toBe(join(repo, '.git', 'info', 'exclude'))
  })
})

describe('isCloudSyncedPath', () => {
  it('detects a symlink whose target lives in a Synology Drive folder', () => {
    const target = join(fx.root, 'SynologyDrive', 'Obsidian')
    mkdirSync(target, { recursive: true })
    const link = join(fx.root, 'vaults', 'claude')
    mkdirSync(join(fx.root, 'vaults'))
    symlinkSync(target, link)
    expect(existsSync(link)).toBe(true)
    expect(isCloudSyncedPath(link)).toBe(true)
  })

  it('detects a not yet existing path below a cloud-synced symlink', () => {
    const target = join(fx.root, 'Dropbox', 'notes')
    mkdirSync(target, { recursive: true })
    const link = join(fx.root, 'notes')
    symlinkSync(target, link)
    expect(isCloudSyncedPath(join(link, 'new', 'folder'))).toBe(true)
  })

  it('does not flag a plain local folder', () => {
    const local = join(fx.root, 'vaults', 'local')
    mkdirSync(local, { recursive: true })
    expect(isCloudSyncedPath(local)).toBe(false)
  })
})
