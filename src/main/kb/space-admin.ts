import { existsSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'path'
import { parseRemote, type GitAuthMode } from '../../shared/kb/git-remote'
import type { KbBackend, KbBackendConfig, KbSpace, KbSpaceInput } from '../../shared/kb/types'

export interface SpaceSettings {
  name?: string
  backend?: KbBackend
  remoteUrl?: string
  branch?: string
  gitAuth?: GitAuthMode
  gitUsername?: string
  sshKeyPath?: string
  authorName?: string
  authorEmail?: string
  folderPath?: string
  sftpHost?: string
  sftpPort?: number
  sftpUser?: string
  sftpPath?: string
  intervalMin?: number
  syncOnWrite?: boolean
  autoCommitExternal?: boolean
  agentWrite?: boolean
  reviewBeforePush?: boolean
  shared?: boolean
}

export interface SpaceChange {
  field: string
  from: string | null
  to: string
}

export interface SpacePlan {
  patch: Partial<KbSpaceInput>
  approval: SpaceChange[]
}

const DESTINATION: Array<[keyof SpaceSettings, keyof KbBackendConfig]> = [
  ['remoteUrl', 'remoteUrl'],
  ['branch', 'branch'],
  ['gitAuth', 'gitAuth'],
  ['gitUsername', 'gitUsername'],
  ['sshKeyPath', 'sshKeyPath'],
  ['authorName', 'authorName'],
  ['authorEmail', 'authorEmail'],
  ['folderPath', 'path'],
  ['sftpHost', 'host'],
  ['sftpPort', 'port'],
  ['sftpUser', 'username'],
  ['sftpPath', 'remotePath']
]

const GIT_REF = /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])[^/].*[^/.]$|^[A-Za-z0-9]$/

export function assertSafeFolder(path: string, home = homedir()): string {
  if (!isAbsolute(path)) throw new Error(`Use an absolute path: ${path}`)
  const full = resolve(path)
  assertNotProtected(full, home)
  assertNotProtected(realPath(full), realPath(home))
  return full
}

function realPath(full: string): string {
  let existing = full
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing)
  return join(realpathSync.native(existing), relative(existing, full))
}

function assertNotProtected(full: string, home: string): void {
  const fromHome = relative(home.toLowerCase(), full.toLowerCase())
  if (full === parse(full).root || fromHome === '') throw new Error('Choose a folder for the notes, not the whole home folder or disk')
  if (home.toLowerCase().startsWith(full.toLowerCase() + sep)) throw new Error('That folder contains the home folder of this computer')
  if (full.split(sep).some((part) => part.startsWith('.') && part.length > 1)) {
    throw new Error('Hidden folders can only be added from the app window')
  }
  const top = fromHome.split(sep)[0]
  if (!fromHome.startsWith('..') && (top === 'library' || top === 'appdata')) {
    throw new Error('System folders can only be added from the app window')
  }
}

export function planSettings(current: KbSpace | null, settings: SpaceSettings): SpacePlan {
  if (current && settings.agentWrite === true && !current.agentWrite) {
    throw new Error('Letting assistants write in a space is up to the person, in the space settings')
  }
  if (current?.reviewBeforePush && settings.reviewBeforePush === false) {
    throw new Error('Turning off the review of assistant changes is up to the person, in the space settings')
  }
  if (current?.shared && settings.shared === false) {
    throw new Error('Turning off the protections of a shared space is up to the person, in the space settings')
  }
  if (settings.remoteUrl !== undefined) parseRemote(settings.remoteUrl)
  if (settings.branch !== undefined && !GIT_REF.test(settings.branch)) throw new Error('The branch name is not valid')

  const before: KbBackendConfig = current?.backendConfig ?? {}
  const next: Record<string, unknown> = { ...before }
  const approval: SpaceChange[] = []
  for (const [setting, key] of DESTINATION) {
    const value = settings[setting]
    if (value === undefined || value === before[key]) continue
    next[key] = value
    approval.push({ field: setting, from: before[key] === undefined ? null : String(before[key]), to: String(value) })
  }
  if (settings.backend !== undefined && settings.backend !== (current?.backend ?? 'none')) {
    approval.unshift({ field: 'backend', from: current?.backend ?? null, to: settings.backend })
  }
  if (current?.encrypted && approval.length > 0) {
    throw new Error('The destination of an encrypted space can only be changed from the app window')
  }
  if (next.host !== before.host || next.port !== before.port) delete next.hostFingerprint

  const patch: Partial<KbSpaceInput> = {}
  if (settings.name !== undefined) patch.name = settings.name
  if (settings.backend !== undefined) patch.backend = settings.backend
  if (approval.some((c) => c.field !== 'backend')) patch.backendConfig = next as KbBackendConfig
  const sync: NonNullable<KbSpaceInput['sync']> = {}
  if (settings.intervalMin !== undefined) sync.intervalMin = settings.intervalMin
  if (settings.syncOnWrite !== undefined) sync.onWrite = settings.syncOnWrite
  if (settings.autoCommitExternal !== undefined) sync.autoCommitExternal = settings.autoCommitExternal
  if (Object.keys(sync).length > 0) patch.sync = sync
  if (settings.agentWrite !== undefined) patch.agentWrite = settings.agentWrite
  if (settings.reviewBeforePush !== undefined) patch.reviewBeforePush = settings.reviewBeforePush
  if (settings.shared !== undefined) {
    patch.shared = settings.shared
    if (settings.shared) patch.reviewBeforePush = true
  }
  return { patch, approval }
}
