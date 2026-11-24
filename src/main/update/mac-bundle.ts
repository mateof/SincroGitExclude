import { execFile, execFileSync } from 'child_process'
import { accessSync, constants, lstatSync, mkdtempSync, readdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import type { UpdateBlocker } from '../../shared/update-types'

const run = promisify(execFile)

export const BUNDLE_ID = 'com.sincrogitexclude.app'
const APP_NAME = 'SincroGitExclude.app'
const STAGE_PREFIX = '.sincrogitexclude-update-'

export function bundlePathOf(execPath: string): string | null {
  const bundle = dirname(dirname(dirname(execPath)))
  return bundle.endsWith('.app') && basename(dirname(dirname(execPath))) === 'Contents' ? bundle : null
}

export function updateBlocker(input: { platform: string; packaged: boolean; execPath: string }): UpdateBlocker | null {
  if (input.platform !== 'darwin') return 'platform'
  const bundle = bundlePathOf(input.execPath)
  if (!input.packaged || !bundle) return 'development'
  if (bundle.includes('/AppTranslocation/')) return 'translocated'
  if (bundle.startsWith('/Volumes/') && !isWritable(dirname(bundle))) return 'disk-image'
  if (!isWritable(dirname(bundle)) || !isWritable(bundle)) return 'not-writable'
  return null
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function createStageDir(bundle: string): string {
  return mkdtempSync(join(dirname(bundle), STAGE_PREFIX))
}

export function removeAppTree(path: string): void {
  execFileSync('/bin/rm', ['-rf', '--', path], { stdio: 'ignore' })
}

export function removeStaleStages(bundle: string): void {
  const parent = dirname(bundle)
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(STAGE_PREFIX)) {
      removeAppTree(join(parent, entry.name))
    }
  }
}

async function plistValue(bundle: string, key: string): Promise<string> {
  const { stdout } = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')])
  return stdout.trim()
}

export async function verifyBundle(bundle: string, expected: { version: string; arch: string }): Promise<void> {
  if (!lstatSync(bundle).isDirectory()) throw new Error('The downloaded image does not contain the app')
  if ((await plistValue(bundle, 'CFBundleIdentifier')) !== BUNDLE_ID) throw new Error('The downloaded app is not SincroGitExclude')
  if ((await plistValue(bundle, 'CFBundleShortVersionString')) !== expected.version) {
    throw new Error('The downloaded app is not the announced version')
  }
  const executable = join(bundle, 'Contents', 'MacOS', await plistValue(bundle, 'CFBundleExecutable'))
  const { stdout } = await run('/usr/bin/lipo', ['-archs', executable])
  const machine = expected.arch === 'x64' ? 'x86_64' : expected.arch
  if (!stdout.trim().split(/\s+/).includes(machine)) throw new Error('The downloaded app is for another processor')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]).catch(() => {
    throw new Error('The signature of the downloaded app is not valid')
  })
}

export async function stageFromImage(
  image: string,
  stageDir: string,
  mountPoint: string,
  expected: { version: string; arch: string }
): Promise<string> {
  const staged = join(stageDir, APP_NAME)
  await run('/usr/bin/hdiutil', ['attach', image, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint])
  try {
    const source = join(mountPoint, APP_NAME)
    if (!lstatSync(source).isDirectory()) throw new Error('The downloaded image does not contain the app')
    await run('/usr/bin/ditto', ['--noqtn', source, staged])
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mountPoint, '-force']).catch(() => undefined)
  }
  await verifyBundle(staged, expected)
  return staged
}
