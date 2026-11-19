import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import {
  deployedTree,
  listChanges,
  hasChanges,
  commitChanges,
  diffWorking,
  listChangesWithStats,
  restoreFromCommit,
  removeDeployedIndex,
  type DeployedTree
} from '../src/main/git/deployed-tree'
import {
  createFixture,
  createInternalRepo,
  deployFiles,
  git,
  readFile,
  writeFile,
  type Fixture
} from './helpers/git-fixture'

const BINARY = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0xc3, 0x28, 0x00, 0x7f, 0xe2, 0x82])

const BASE_FILES = {
  'config/app.json': '{"port": 1}\n',
  'config/secrets.env': 'TOKEN=abc\n',
  'readme.txt': 'hello\n',
  'assets/logo.bin': BINARY
}

describe('deployed tree', () => {
  let fx: Fixture
  let tree: DeployedTree

  beforeEach(async () => {
    fx = createFixture()
    await createInternalRepo(fx.repo, BASE_FILES)
    deployFiles(fx.deployed, BASE_FILES)
    tree = deployedTree(fx.repo, 'dep-1', fx.deployed, 'deploy-test', [])
  })

  afterEach(() => fx.cleanup())

  it('reports nothing when the deployed folder matches the branch', async () => {
    expect(await listChanges(tree)).toEqual([])
    expect(await hasChanges(tree)).toBe(false)
  })

  it('reports modified, added and deleted files without touching the internal working tree', async () => {
    writeFile(fx.deployed, 'readme.txt', 'changed\n')
    writeFile(fx.deployed, 'new/file.txt', 'new\n')
    rmSync(join(fx.deployed, 'config/secrets.env'))

    expect(await listChanges(tree)).toEqual([
      { path: 'config/secrets.env', kind: 'deleted' },
      { path: 'new/file.txt', kind: 'added' },
      { path: 'readme.txt', kind: 'modified' }
    ])
    expect(readFile(fx.repo, 'readme.txt').toString()).toBe('hello\n')
    expect(await git(fx.repo, 'status', '--porcelain')).toBe('')
  })

  it('never reports files under ignore patterns, tracked or not', async () => {
    tree.ignorePatterns = ['node_modules/', '*.log', 'config/secrets.env']
    writeFile(fx.deployed, 'node_modules/pkg/index.js', 'x')
    writeFile(fx.deployed, 'deep/debug.log', 'x')
    writeFile(fx.deployed, 'config/secrets.env', 'TOKEN=changed\n')

    expect(await listChanges(tree)).toEqual([])
  })

  it('still sees new files hidden by a .gitignore that lives inside the deployed folder', async () => {
    writeFile(fx.deployed, 'config/.gitignore', '*\n')
    writeFile(fx.deployed, 'config/local.json', '{}\n')
    writeFile(fx.deployed, 'config/nested/deep.json', '{}\n')

    const paths = (await listChanges(tree)).map((c) => c.path)
    expect(paths).toEqual(['config/.gitignore', 'config/local.json', 'config/nested/deep.json'])
  })

  it('ignores the user global excludes file so managed .env files are not hidden', async () => {
    const globalIgnore = join(fx.root, 'global-ignore')
    writeFileSync(globalIgnore, '.env\n*.env\n')
    appendFileSync(fx.globalConfig, `[core]\n\texcludesFile = ${globalIgnore.replace(/\\/g, '/')}\n`)
    writeFile(fx.deployed, '.env', 'A=1\n')

    expect((await listChanges(tree)).map((c) => c.path)).toEqual(['.env'])
  })

  it('treats a CRLF working copy as unchanged when autocrlf normalises it', async () => {
    await git(fx.repo, 'config', 'core.autocrlf', 'true')
    writeFile(fx.deployed, 'readme.txt', 'hello\r\n')

    expect(await hasChanges(tree)).toBe(false)
  })

  it('commits straight onto the deployment branch and leaves nothing pending', async () => {
    writeFile(fx.deployed, 'readme.txt', 'v2\n')
    writeFile(fx.deployed, 'added.txt', 'a\n')
    const before = await git(fx.repo, 'rev-parse', 'deploy-test')

    const commit = await commitChanges(tree, 'second')

    expect(await git(fx.repo, 'rev-parse', 'deploy-test')).toBe(commit)
    expect(await git(fx.repo, 'rev-parse', `${commit}^`)).toBe(before)
    expect(await git(fx.repo, 'show', `${commit}:readme.txt`)).toBe('v2')
    expect(await git(fx.repo, 'show', `${commit}:added.txt`)).toBe('a')
    expect(await git(fx.repo, 'rev-parse', 'master')).not.toBe(commit)
    expect(await hasChanges(tree)).toBe(false)
  })

  it('commits only the selected paths', async () => {
    writeFile(fx.deployed, 'readme.txt', 'v2\n')
    writeFile(fx.deployed, 'config/app.json', '{"port": 2}\n')

    const commit = await commitChanges(tree, 'only readme', ['readme.txt'])

    expect(await git(fx.repo, 'show', `${commit}:readme.txt`)).toBe('v2')
    expect(await git(fx.repo, 'show', `${commit}:config/app.json`)).toBe('{"port": 1}')
    expect((await listChanges(tree)).map((c) => c.path)).toEqual(['config/app.json'])
  })

  it('refuses to create an empty commit', async () => {
    await expect(commitChanges(tree, 'nothing')).rejects.toThrow('No changes to commit')
  })

  it('keeps the internal working tree clean when committing to the checked-out branch', async () => {
    await git(fx.repo, 'checkout', '-q', 'deploy-test')
    writeFile(fx.deployed, 'readme.txt', 'v2\n')

    await commitChanges(tree, 'second')

    expect(await git(fx.repo, 'status', '--porcelain')).toBe('')
    expect(readFile(fx.repo, 'readme.txt').toString()).toBe('v2\n')
  })

  it('notices when the branch moved under it and re-reads the index', async () => {
    expect(await hasChanges(tree)).toBe(false)
    await git(fx.repo, 'checkout', '-q', 'deploy-test')
    writeFile(fx.repo, 'readme.txt', 'from elsewhere\n')
    await git(fx.repo, 'commit', '-q', '-am', 'moved')

    expect(await listChanges(tree)).toEqual([{ path: 'readme.txt', kind: 'modified' }])
  })

  it('restores binary files byte for byte', async () => {
    const commit = await git(fx.repo, 'rev-parse', 'deploy-test')
    writeFile(fx.deployed, 'assets/logo.bin', Buffer.from('broken'))

    await restoreFromCommit(tree, commit, ['assets/logo.bin'])

    expect(readFile(fx.deployed, 'assets/logo.bin').equals(BINARY)).toBe(true)
  })

  it('restores every file of a commit into an empty folder', async () => {
    const commit = await git(fx.repo, 'rev-parse', 'deploy-test')
    rmSync(fx.deployed, { recursive: true, force: true })

    await restoreFromCommit(tree, commit)

    expect(readFile(fx.deployed, 'assets/logo.bin').equals(BINARY)).toBe(true)
    expect(readFile(fx.deployed, 'config/app.json').toString()).toBe('{"port": 1}\n')
    expect(await hasChanges(tree)).toBe(false)
  })

  it('produces a patch that includes brand new files', async () => {
    writeFile(fx.deployed, 'readme.txt', 'v2\n')
    writeFile(fx.deployed, 'brand-new.txt', 'fresh\n')

    const patch = await diffWorking(tree)

    expect(patch).toContain('diff --git a/brand-new.txt b/brand-new.txt')
    expect(patch).toContain('+fresh')
    expect(patch).toContain('-hello')
    expect(await hasChanges(tree)).toBe(true)
  })

  it('counts added and deleted lines per changed file', async () => {
    writeFile(fx.deployed, 'readme.txt', 'one\ntwo\n')
    writeFile(fx.deployed, 'extra.txt', 'a\nb\nc\n')

    expect(await listChangesWithStats(tree)).toEqual([
      { path: 'extra.txt', kind: 'added', additions: 3, deletions: 0 },
      { path: 'readme.txt', kind: 'modified', additions: 2, deletions: 1 }
    ])
  })

  it('removes every per-deployment file when the deployment goes away', async () => {
    await hasChanges(tree)
    expect(existsSync(tree.indexFile)).toBe(true)

    removeDeployedIndex(fx.repo, 'dep-1')

    expect(existsSync(tree.indexFile)).toBe(false)
    expect(existsSync(`${tree.indexFile}.head`)).toBe(false)
    expect(existsSync(`${tree.indexFile}.exclude`)).toBe(false)
  })
})
