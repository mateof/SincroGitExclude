import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertNewerVersion, selectMacAsset, type GithubRelease } from '../src/main/update/release'
import { downloadAsset, type FetchLike } from '../src/main/update/download'
import { bundlePathOf, createStageDir, removeStaleStages, stageFromImage, updateBlocker } from '../src/main/update/mac-bundle'
import { swapArguments } from '../src/main/update/swap'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sge-update-test-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const version = '1.21.0-dev.3'
const name = `sincrogitexclude-${version}-arm64.dmg`
const asset = {
  name,
  size: 10,
  digest: `sha256:${'a'.repeat(64)}`,
  browser_download_url: `https://github.com/mateof/SincroGitExclude/releases/download/v${version}/${name}`
}
const release = (patch: Partial<typeof asset> = {}): GithubRelease => ({ tag_name: `v${version}`, assets: [{ ...asset, ...patch }] })

describe('choosing what to download', () => {
  it('takes the image of this processor with its size and hash', () => {
    expect(selectMacAsset(release(), version, 'arm64')).toEqual({
      version,
      url: asset.browser_download_url,
      size: 10,
      sha256: 'a'.repeat(64)
    })
  })

  it('refuses a release without an image for this processor', () => {
    expect(() => selectMacAsset(release(), version, 'x64')).toThrow(/no macOS build/)
  })

  it('refuses a file without a published hash', () => {
    expect(() => selectMacAsset(release({ digest: '' }), version, 'arm64')).toThrow(/SHA-256/)
  })

  it('refuses a file served from anywhere but the official repository', () => {
    const other = `https://github.com/someone/else/releases/download/v${version}/${name}`
    expect(() => selectMacAsset(release({ browser_download_url: other }), version, 'arm64')).toThrow(/address/)
  })

  it('refuses drafts and other tags', () => {
    expect(() => selectMacAsset({ ...release(), draft: true }, version, 'arm64')).toThrow(/not published/)
    expect(() => selectMacAsset({ ...release(), tag_name: 'v1.0.0' }, version, 'arm64')).toThrow(/not published/)
  })

  it('never goes back to an older or equal version', () => {
    expect(() => assertNewerVersion('1.21.0', version)).toThrow(/not newer/)
    expect(() => assertNewerVersion(version, version)).toThrow(/not newer/)
    expect(() => assertNewerVersion('1.21.0-dev.2', version)).not.toThrow()
  })

  it('refuses a version that could change the address', () => {
    for (const bad of ['../../x', '1.0', 'v9.0.0', '9.0.0/../..', '9.0.0?x=1']) {
      expect(() => assertNewerVersion('1.0.0', bad)).toThrow(/Invalid version/)
    }
  })
})

describe('downloading', () => {
  const body = Buffer.from('contents of the image')
  const good = { version, url: 'https://example.test/a.dmg', size: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  const serve = (data: Buffer): FetchLike => async () => new Response(new Uint8Array(data))
  const run = (fetcher: FetchLike, a = good) => downloadAsset(fetcher, a, join(root, 'a.dmg'), new AbortController().signal, () => undefined)

  it('keeps a file that matches the hash', async () => {
    await run(serve(body))
    expect(readFileSync(join(root, 'a.dmg'))).toEqual(body)
  })

  it('rejects a file with the right size and other content', async () => {
    await expect(run(serve(Buffer.alloc(body.length, 1)))).rejects.toThrow(/SHA-256/)
  })

  it('rejects a truncated or oversized file', async () => {
    await expect(run(serve(body.subarray(1)))).rejects.toThrow(/incomplete/)
    rmSync(join(root, 'a.dmg'), { force: true })
    await expect(run(serve(Buffer.concat([body, body])))).rejects.toThrow(/larger/)
  })

  it('gives up when no data arrives', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
    await expect(
      downloadAsset(hang, good, join(root, 'a.dmg'), new AbortController().signal, () => undefined, 30)
    ).rejects.toThrow(/stalled/)
  })

  it('stops when the person cancels', async () => {
    const abort = new AbortController()
    const endless: FetchLike = async () =>
      new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1)) }))
    const pending = downloadAsset(endless, { ...good, size: 1e9 }, join(root, 'a.dmg'), abort.signal, () => abort.abort())
    await expect(pending).rejects.toThrow()
  })
})

describe('where the app can replace itself', () => {
  const appIn = (dir: string) => {
    const macos = join(dir, 'SincroGitExclude.app', 'Contents', 'MacOS')
    mkdirSync(macos, { recursive: true })
    return join(macos, 'SincroGitExclude')
  }

  it('finds the bundle of the executable', () => {
    expect(bundlePathOf('/Applications/A.app/Contents/MacOS/A')).toBe('/Applications/A.app')
    expect(bundlePathOf('/usr/local/bin/electron')).toBeNull()
  })

  it('works in a writable folder and nowhere else', () => {
    const execPath = appIn(root)
    expect(updateBlocker({ platform: 'darwin', packaged: true, execPath })).toBeNull()
    expect(updateBlocker({ platform: 'win32', packaged: true, execPath })).toBe('platform')
    expect(updateBlocker({ platform: 'darwin', packaged: false, execPath })).toBe('development')
    expect(
      updateBlocker({ platform: 'darwin', packaged: true, execPath: '/private/var/x/AppTranslocation/1/d/A.app/Contents/MacOS/A' })
    ).toBe('translocated')
    expect(updateBlocker({ platform: 'darwin', packaged: true, execPath: '/Volumes/missing/A.app/Contents/MacOS/A' })).toBe('disk-image')
  })

  it('only clears its own leftovers', () => {
    const bundle = join(root, 'SincroGitExclude.app')
    mkdirSync(bundle)
    mkdirSync(join(root, 'Other.app'))
    createStageDir(bundle)
    removeStaleStages(bundle)
    expect(readdirSync(root).sort()).toEqual(['Other.app', 'SincroGitExclude.app'])
  })
})

describe.skipIf(process.platform === 'win32')('replacing the app', () => {
  const setup = (openExit: string) => {
    const target = join(root, 'App.app')
    const stage = join(root, 'stage')
    const staged = join(stage, 'App.app')
    mkdirSync(target)
    mkdirSync(staged, { recursive: true })
    writeFileSync(join(target, 'version'), 'old')
    writeFileSync(join(staged, 'version'), 'new')
    const opener = join(root, 'open.sh')
    writeFileSync(opener, `echo "$(cat "$1/version")" >> "${root}/opened"\n${openExit}\n`)
    writeFileSync(opener, '#!/bin/sh\n' + readFileSync(opener, 'utf-8'))
    chmodSync(opener, 0o755)
    return { target, stage, staged, opener, failureFile: join(root, 'failure') }
  }
  const opened = () => readFileSync(join(root, 'opened'), 'utf-8').trim().split('\n')
  const current = (target: string) => readFileSync(join(target, 'version'), 'utf-8')
  const deadPid = () => spawnSync('true').pid

  it('puts the new version in place, opens it and leaves nothing behind', () => {
    const s = setup('exit 0')
    expect(spawnSync('/bin/sh', swapArguments({ pid: deadPid(), ...s })).status).toBe(0)
    expect(current(s.target)).toBe('new')
    expect(opened()).toEqual(['new'])
    expect(existsSync(s.stage)).toBe(false)
    expect(existsSync(s.failureFile)).toBe(false)
  })

  it('goes back to the previous version when the new one does not open', () => {
    const s = setup('[ "$(cat "$1/version")" = old ]')
    expect(spawnSync('/bin/sh', swapArguments({ pid: deadPid(), ...s })).status).toBe(5)
    expect(current(s.target)).toBe('old')
    expect(opened()).toEqual(['new', 'old'])
    expect(readFileSync(s.failureFile, 'utf-8').trim()).toBe('5')
  })

  it('goes back to the previous version when the new one disappears', () => {
    const s = setup('exit 0')
    rmSync(s.staged, { recursive: true })
    expect(spawnSync('/bin/sh', swapArguments({ pid: deadPid(), ...s })).status).toBe(4)
    expect(current(s.target)).toBe('old')
    expect(opened()).toEqual(['old'])
    expect(readFileSync(s.failureFile, 'utf-8').trim()).toBe('4')
  })

  it('waits for the app to close and gives up if it does not', () => {
    const s = setup('exit 0')
    const alive = spawn('sleep', ['30'])
    try {
      expect(spawnSync('/bin/sh', swapArguments({ pid: alive.pid!, tries: 2, ...s })).status).toBe(2)
      expect(current(s.target)).toBe('old')
      expect(existsSync(join(root, 'opened'))).toBe(false)
    } finally {
      alive.kill()
    }
  })

  it('handles paths with spaces and shell characters', () => {
    const target = join(root, "My $(touch pwned) 'App'.app")
    const s = setup('exit 0')
    mkdirSync(target)
    writeFileSync(join(target, 'version'), 'old')
    expect(spawnSync('/bin/sh', swapArguments({ pid: deadPid(), ...s, target }), { cwd: root }).status).toBe(0)
    expect(current(target)).toBe('new')
    expect(existsSync(join(root, 'pwned'))).toBe(false)
  })
})

describe.skipIf(process.platform !== 'darwin')('checking a real disk image', () => {
  const machine = () => execFileSync('/usr/bin/lipo', ['-archs', '/bin/ls'], { encoding: 'utf-8' }).trim().split(/\s+/)
  const build = (options: { id?: string; version?: string; tamper?: boolean; sign?: boolean } = {}) => {
    const src = join(root, 'src')
    const app = join(src, 'SincroGitExclude.app')
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(app, 'Contents', 'Resources'))
    const executable = join(app, 'Contents', 'MacOS', 'SincroGitExclude')
    writeFileSync(executable, readFileSync('/bin/ls'))
    chmodSync(executable, 0o755)
    writeFileSync(join(app, 'Contents', 'Resources', 'data.txt'), 'original')
    writeFileSync(
      join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${options.id ?? 'com.sincrogitexclude.app'}</string><key>CFBundleShortVersionString</key><string>${options.version ?? version}</string><key>CFBundleExecutable</key><string>SincroGitExclude</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
    )
    if (options.sign !== false) execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })
    if (options.tamper) writeFileSync(join(app, 'Contents', 'Resources', 'data.txt'), 'changed')
    const image = join(root, 'a.dmg')
    execFileSync('/usr/bin/hdiutil', ['create', '-quiet', '-srcfolder', src, '-volname', 'SgeUpdateTest', '-ov', image])
    const stage = join(root, 'stage')
    const mount = join(root, 'mount')
    mkdirSync(stage)
    mkdirSync(mount)
    const arch = machine().includes('x86_64') ? 'x64' : machine()[0]
    return () => stageFromImage(image, stage, mount, { version, arch })
  }

  it('accepts the announced app and unmounts the image', async () => {
    const staged = await build()()
    expect(existsSync(join(staged, 'Contents', 'Info.plist'))).toBe(true)
    expect(readdirSync(join(root, 'mount'))).toEqual([])
  }, 60_000)

  it('rejects an app changed after signing', async () => {
    await expect(build({ tamper: true })()).rejects.toThrow(/signature/)
  }, 60_000)

  it('rejects another app', async () => {
    await expect(build({ id: 'com.other.app' })()).rejects.toThrow(/not SincroGitExclude/)
  }, 60_000)

  it('rejects another version', async () => {
    await expect(build({ version: '1.0.0' })()).rejects.toThrow(/announced version/)
  }, 60_000)

  it('rejects the incomplete signature of the broken dev.1 and dev.2 builds', async () => {
    await expect(build({ sign: false })()).rejects.toThrow(/signature/)
  }, 60_000)
})
