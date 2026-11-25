import { describe, it, expect, afterEach } from 'vitest'
import { readBlobsBatch, readBlobWithFilters, execGitText } from '../src/main/git/git-exec'
import { createFixture, createInternalRepo, git, type Fixture } from './helpers/git-fixture'

const BINARY = Buffer.from([0x00, 0xff, 0x0a, 0xfe, 0x0a, 0x0a, 0x80])

describe('git exec helpers', () => {
  let fx: Fixture
  afterEach(() => fx.cleanup())

  it('reads many blobs in one process and keeps binary bytes intact', async () => {
    fx = createFixture()
    await createInternalRepo(fx.repo, { 'a.txt': 'alpha\n', 'bin/data.bin': BINARY, 'empty': '' })

    const blobs = await readBlobsBatch(fx.repo, 'HEAD', ['a.txt', 'bin/data.bin', 'missing.txt', 'empty'])

    expect(blobs.get('a.txt')?.toString()).toBe('alpha\n')
    expect(blobs.get('bin/data.bin')?.equals(BINARY)).toBe(true)
    expect(blobs.get('empty')?.length).toBe(0)
    expect(blobs.has('missing.txt')).toBe(false)
  })

  it('applies end-of-line conversion when reading a file to put on disk', async () => {
    fx = createFixture()
    await createInternalRepo(fx.repo, { content: 'one\ntwo\n' })
    await git(fx.repo, 'config', 'core.autocrlf', 'true')

    const forDisk = await readBlobWithFilters(fx.repo, 'HEAD', 'content')

    expect(forDisk.toString()).toBe('one\r\ntwo\r\n')
  })

  it('reports the failing subcommand and stderr when git fails', async () => {
    fx = createFixture()
    await createInternalRepo(fx.repo, { a: 'a' })
    await expect(execGitText(['-c', 'x.y=z', 'rev-parse', 'nope'], { cwd: fx.repo })).rejects.toThrow(
      /git rev-parse failed \(128\)/
    )
  })
})
