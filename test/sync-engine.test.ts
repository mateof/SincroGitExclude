import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync } from 'fs'
import {
  cloneFile,
  emptyMeta,
  fetchFile,
  fetchMeta,
  integrateFile,
  lsRemote,
  mergeMeta,
  MetaConflictError,
  pushFile,
  pushMeta,
  readLocalMeta,
  remoteBranchesOf,
  remoteFilePrefix,
  remoteTagsOf,
  type MetaFile,
  type MetaMachine
} from '../src/main/sync/sync-engine'
import { createFixture, createInternalRepo, git, writeFile, type Fixture } from './helpers/git-fixture'

function metaFile(id: string, updatedAt: string, name = id): MetaFile {
  return {
    id,
    name,
    alias: name,
    type: 'bundle',
    useAutoIcon: true,
    ignorePatterns: '',
    tags: [],
    createdAt: '2026-01-01 00:00:00',
    updatedAt
  }
}

function machine(name: string): MetaMachine {
  return { name, updatedAt: '2026-01-01 00:00:00', deployments: [] }
}

describe('sync metadata merge', () => {
  it('keeps the newest version of each file', () => {
    const remote = { ...emptyMeta(), files: { a: metaFile('a', '2026-01-02 00:00:00', 'remote') } }
    const merged = mergeMeta(remote, {
      files: [metaFile('a', '2026-01-01 00:00:00', 'local'), metaFile('b', '2026-01-01 00:00:00')],
      tombstones: {},
      machineId: 'm1',
      machine: machine('mac')
    })
    expect(merged.files.a.name).toBe('remote')
    expect(Object.keys(merged.files).sort()).toEqual(['a', 'b'])
  })

  it('drops files deleted after their last edit so they do not come back on the next pull', () => {
    const remote = { ...emptyMeta(), files: { a: metaFile('a', '2026-01-01 00:00:00') } }
    const merged = mergeMeta(remote, {
      files: [],
      tombstones: { a: '2026-01-05 00:00:00' },
      machineId: 'm1',
      machine: machine('mac')
    })
    expect(merged.files.a).toBeUndefined()
    expect(merged.tombstones.a).toBe('2026-01-05 00:00:00')
  })

  it('only replaces the section of the machine that pushes', () => {
    const remote = { ...emptyMeta(), machines: { other: machine('windows') } }
    const merged = mergeMeta(remote, { files: [], tombstones: {}, machineId: 'm1', machine: machine('mac') })
    expect(Object.keys(merged.machines).sort()).toEqual(['m1', 'other'])
  })
})

describe('sync against a git remote', () => {
  let fx: Fixture
  let remote: string
  let repoA: string
  let repoB: string
  const fileId = 'file-1'

  beforeEach(async () => {
    fx = createFixture()
    remote = join(fx.root, 'remote.git')
    mkdirSync(remote)
    await git(remote, 'init', '--bare', '-q')
    repoA = join(fx.root, 'a', fileId)
    repoB = join(fx.root, 'b', fileId)
    await createInternalRepo(repoA, { 'cfg/app.json': '{}\n' }, 'deploy-aaaa1111')
    await git(repoA, 'tag', 'deploy-aaaa1111/v1', 'deploy-aaaa1111')
  })

  afterEach(() => fx.cleanup())

  it('pushes every branch and tag of a file under its own namespace', async () => {
    const result = await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))
    const refs = await lsRemote(remote, fx.root)

    expect(result.status).toBe('pushed')
    expect(refs.has(`${remoteFilePrefix(fileId)}master`)).toBe(true)
    expect(refs.has(`${remoteFilePrefix(fileId)}deploy-aaaa1111`)).toBe(true)
    expect(refs.has(`refs/tags/sge/files/${fileId}/deploy-aaaa1111/v1`)).toBe(true)
  })

  it('accepts a bare repository on a mounted share whose path has spaces', async () => {
    const shared = join(fx.root, 'My NAS', 'sge data.git')
    mkdirSync(shared, { recursive: true })
    await git(shared, 'init', '--bare', '-q')

    const result = await pushFile(repoA, shared, fileId, await lsRemote(shared, fx.root))

    expect(result.status).toBe('pushed')
    expect((await lsRemote(shared, fx.root)).has(`${remoteFilePrefix(fileId)}master`)).toBe(true)
  })

  it('skips the network round trip when the remote already has everything', async () => {
    await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))
    const again = await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))
    expect(again.status).toBe('up-to-date')
  })

  it('recreates a file on another machine with its base branch checked out', async () => {
    await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))

    const base = await cloneFile(repoB, remote, fileId)

    expect(base).toBe('master')
    expect(await git(repoB, 'rev-parse', 'master')).toBe(await git(repoA, 'rev-parse', 'master'))
    expect([...(await remoteBranchesOf(repoB)).keys()].sort()).toEqual(['deploy-aaaa1111', 'master'])
    expect([...(await remoteTagsOf(repoB)).values()]).toEqual(['deploy-aaaa1111/v1'])
    expect(await git(repoB, 'status', '--porcelain')).toBe('')
  })

  it('fast-forwards shared branches but never moves branches owned by local deployments', async () => {
    await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))
    await cloneFile(repoB, remote, fileId)
    await git(repoB, 'branch', 'deploy-aaaa1111', 'refs/remotes/sge/deploy-aaaa1111')

    await git(repoA, 'checkout', '-q', 'master')
    writeFile(repoA, 'cfg/app.json', '{"v":2}\n')
    await git(repoA, 'commit', '-q', '-am', 'v2')
    await git(repoA, 'checkout', '-q', 'deploy-aaaa1111')
    writeFile(repoA, 'cfg/app.json', '{"v":3}\n')
    await git(repoA, 'commit', '-q', '-am', 'v3')
    await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))

    await fetchFile(repoB, remote, fileId)
    const reports = await integrateFile(repoB, new Set(['deploy-aaaa1111']))

    expect(reports.sort((x, y) => x.branch.localeCompare(y.branch))).toEqual([
      { branch: 'deploy-aaaa1111', state: 'behind' },
      { branch: 'master', state: 'fast-forwarded' }
    ])
    expect(await git(repoB, 'show', 'master:cfg/app.json')).toBe('{"v":2}')
    expect(await git(repoB, 'status', '--porcelain')).toBe('')
  })

  it('reports a rejected push instead of overwriting history from another machine', async () => {
    await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))
    await cloneFile(repoB, remote, fileId)

    writeFile(repoB, 'cfg/app.json', '{"from":"b"}\n')
    await git(repoB, 'commit', '-q', '-am', 'b')
    await pushFile(repoB, remote, fileId, await lsRemote(remote, fx.root))

    await git(repoA, 'checkout', '-q', 'master')
    writeFile(repoA, 'cfg/app.json', '{"from":"a"}\n')
    await git(repoA, 'commit', '-q', '-am', 'a')
    const result = await pushFile(repoA, remote, fileId, await lsRemote(remote, fx.root))

    expect(result.status).toBe('conflict')
    expect(result.rejected.map((r) => r.ref)).toEqual(['refs/heads/master'])
  })

  it('round-trips metadata and refuses to overwrite metadata it has not seen', async () => {
    const metaA = join(fx.root, 'meta-a.git')
    const metaB = join(fx.root, 'meta-b.git')
    const local = { files: [metaFile(fileId, '2026-01-01 00:00:00')], tombstones: {}, machineId: 'a', machine: machine('mac') }

    const first = await fetchMeta(metaA, remote, await lsRemote(remote, fx.root))
    expect(first.meta).toBeNull()
    await pushMeta(metaA, remote, mergeMeta(null, local), null, 'from a')

    const seenByB = await fetchMeta(metaB, remote, await lsRemote(remote, fx.root))
    expect(seenByB.meta?.files[fileId].name).toBe(fileId)
    expect((await readLocalMeta(metaB))?.machines.a.name).toBe('mac')

    await pushMeta(metaB, remote, mergeMeta(seenByB.meta, { ...local, machineId: 'b', machine: machine('win') }), seenByB.parent, 'from b')

    await expect(
      pushMeta(metaA, remote, mergeMeta(null, local), first.parent, 'stale')
    ).rejects.toBeInstanceOf(MetaConflictError)
  })
})
