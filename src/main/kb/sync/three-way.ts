import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { hashContent } from '../index/space-index'
import { atomicWrite } from '../note-writer'
import { conflictCopyName, emptyReport } from './git-space'
import { scanText, isScannable } from '../secrets/scanner'
import type { RemoteEntry, RemoteStore } from './remote-store'
import { isStoreInternal } from './remote-store'
import type { KbSyncReport } from '../../../shared/kb/types'

export interface BaseEntry {
  localHash: string | null
  remoteHash: string | null
  remoteSize: number | null
  remoteMtime: number | null
}

export type SyncState = Map<string, BaseEntry>

export interface ThreeWayOptions {
  machineName: string
  childDirs?: string[]
  blockSecrets: boolean
  allowPush?: () => { ok: true } | { ok: false; reason: 'review' | 'locked' | 'readonly'; message: string }
  now?: () => Date
  massDeleteGuard?: { minFiles: number; ratio: number }
}

export function isSyncable(rel: string, childDirs: string[] = []): boolean {
  if (!rel || isStoreInternal(rel)) return false
  const parts = rel.split('/')
  if (parts.some((p) => p === '.git' || p === '.trash' || p === '.DS_Store' || p === 'Thumbs.db')) return false
  if (rel.startsWith('.sge-kb/local/') || rel === '.sge-kb/space.json') return false
  if (/^\.obsidian\/workspace[^/]*\.json$/.test(rel) || rel.startsWith('.obsidian/cache')) return false
  if (parts.some((p) => p.startsWith('.') && p !== '.obsidian' && p !== '.sge-kb')) return false
  if (childDirs.some((d) => rel === d || rel.startsWith(`${d}/`))) return false
  return true
}

export async function scanLocal(root: string, childDirs: string[] = []): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>()
  const walk = async (rel: string): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(rel ? join(root, ...rel.split('/')) : root, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (isSyncable(`${child}/x`, childDirs)) await walk(child)
      } else if (entry.isFile() && isSyncable(child, childDirs)) {
        const stat = await fs.stat(join(root, ...child.split('/')))
        out.set(child, { size: stat.size, mtimeMs: stat.mtimeMs })
      }
    }
  }
  await walk('')
  return out
}

async function localHash(root: string, rel: string): Promise<{ hash: string; data: Buffer }> {
  const data = await fs.readFile(join(root, ...rel.split('/')))
  return { hash: hashContent(data), data }
}

async function trashLocal(root: string, rel: string): Promise<void> {
  const from = join(root, ...rel.split('/'))
  let target = join(root, '.trash', ...rel.split('/'))
  let n = 1
  while (await fs.stat(target).then(() => true, () => false)) {
    target = join(root, '.trash', ...`${rel} ${n++}`.split('/'))
  }
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.rename(from, target)
}

type Action =
  | { kind: 'upload'; path: string }
  | { kind: 'download'; path: string }
  | { kind: 'delete-remote'; path: string }
  | { kind: 'delete-local'; path: string }
  | { kind: 'conflict'; path: string }
  | { kind: 'record'; path: string }
  | { kind: 'forget'; path: string }

export async function syncThreeWay(
  root: string,
  store: RemoteStore,
  state: SyncState,
  options: ThreeWayOptions
): Promise<{ report: KbSyncReport; state: SyncState }> {
  const report = emptyReport()
  const now = options.now ?? (() => new Date())
  const next: SyncState = new Map(state)
  await store.open()
  try {
    const remoteList = (await store.list()).filter((e) => isSyncable(e.path, options.childDirs))
    const remote = new Map<string, RemoteEntry>(remoteList.map((e) => [e.path, e]))
    const local = await scanLocal(root, options.childDirs)
    const localHashes = new Map<string, string>()
    const localData = new Map<string, Buffer>()
    for (const path of local.keys()) {
      const { hash, data } = await localHash(root, path)
      localHashes.set(path, hash)
      localData.set(path, data)
    }
    const remoteData = new Map<string, Buffer>()
    const remoteHashOf = async (path: string): Promise<string | null> => {
      const entry = remote.get(path)
      if (!entry) return null
      if (entry.hash) return entry.hash
      const base = state.get(path)
      if (base && base.remoteSize === entry.size && base.remoteMtime === entry.mtimeMs && base.remoteHash) {
        return base.remoteHash
      }
      const data = await store.read(path)
      remoteData.set(path, data)
      return hashContent(data)
    }

    const actions: Action[] = []
    const paths = new Set<string>([...local.keys(), ...remote.keys(), ...state.keys()])
    for (const path of [...paths].sort()) {
      if (!isSyncable(path, options.childDirs)) continue
      const L = localHashes.get(path) ?? null
      const base = state.get(path)
      const R = await remoteHashOf(path)
      const localChanged = base ? L !== base.localHash : L !== null
      const remoteChanged = base ? R !== base.remoteHash : R !== null
      if (L === null && R === null) {
        if (base) actions.push({ kind: 'forget', path })
        continue
      }
      if (!localChanged && !remoteChanged) continue
      if (L !== null && R !== null && L === R) {
        actions.push({ kind: 'record', path })
        continue
      }
      if (localChanged && !remoteChanged) {
        actions.push(L === null ? { kind: 'delete-remote', path } : { kind: 'upload', path })
      } else if (!localChanged && remoteChanged) {
        actions.push(R === null ? { kind: 'delete-local', path } : { kind: 'download', path })
      } else if (L === null) {
        actions.push({ kind: 'download', path })
      } else if (R === null) {
        actions.push({ kind: 'upload', path })
      } else {
        actions.push({ kind: 'conflict', path })
      }
    }

    const guard = options.massDeleteGuard ?? { minFiles: 10, ratio: 0.5 }
    const tracked = state.size
    const remoteDeletes = actions.filter((a) => a.kind === 'delete-remote').length
    const localDeletes = actions.filter((a) => a.kind === 'delete-local').length
    if (tracked >= guard.minFiles && (remoteDeletes / tracked > guard.ratio || localDeletes / tracked > guard.ratio)) {
      report.ok = false
      report.message =
        remoteDeletes > localDeletes
          ? `Sync stopped: it would delete ${remoteDeletes} of ${tracked} files on the remote. Is the local folder complete?`
          : `Sync stopped: it would delete ${localDeletes} of ${tracked} local files. Is the remote path right?`
      return { report, state }
    }

    const uploads = actions.filter((a) => a.kind === 'upload' || a.kind === 'delete-remote' || a.kind === 'conflict')
    if (uploads.length > 0) {
      const findings: KbSyncReport['secrets'] = []
      for (const action of uploads) {
        if (action.kind === 'delete-remote') continue
        const data = localData.get(action.path)
        if (!data || !isScannable(action.path, data.length)) continue
        for (const f of scanText(data.toString('utf-8'))) findings.push({ path: action.path, rule: f.rule, line: f.line })
      }
      report.secrets = findings
    }
    const gate = options.allowPush?.() ?? { ok: true as const }
    const pushBlocked =
      (report.secrets.length > 0 && options.blockSecrets) || !gate.ok
    if (report.secrets.length > 0 && options.blockSecrets) {
      report.blockedBy = 'secrets'
      report.message = 'Upload blocked: possible secrets in the outgoing notes. Remove them or mark the line with sge-kb:allow-secret.'
    } else if (!gate.ok) {
      report.blockedBy = gate.reason
      report.message = gate.message
    }

    const changedRemote: string[] = []
    const removedRemote: string[] = []
    const record = (path: string, hash: string | null, entry: RemoteEntry | undefined): void => {
      next.set(path, {
        localHash: hash,
        remoteHash: hash,
        remoteSize: entry?.size ?? null,
        remoteMtime: entry?.mtimeMs ?? null
      })
    }
    const fetchRemote = async (path: string): Promise<Buffer> => remoteData.get(path) ?? (await store.read(path))

    for (const action of actions) {
      const { path } = action
      switch (action.kind) {
        case 'forget':
          next.delete(path)
          break
        case 'record':
          record(path, localHashes.get(path)!, remote.get(path))
          break
        case 'download': {
          const data = await fetchRemote(path)
          await atomicWrite(join(root, ...path.split('/')), data)
          record(path, hashContent(data), remote.get(path))
          report.pulled.push(path)
          break
        }
        case 'delete-local':
          await trashLocal(root, path)
          next.delete(path)
          report.deletedLocal.push(path)
          break
        case 'upload': {
          if (pushBlocked) break
          const entry = await store.write(path, localData.get(path)!)
          record(path, localHashes.get(path)!, entry)
          changedRemote.push(path)
          report.pushed.push(path)
          break
        }
        case 'delete-remote':
          if (pushBlocked) break
          await store.remove(path)
          next.delete(path)
          removedRemote.push(path)
          report.deletedRemote.push(path)
          break
        case 'conflict': {
          const remoteBytes = await fetchRemote(path)
          const ours = localData.get(path)!
          let copy = conflictCopyName(path, options.machineName, now())
          let n = 2
          while (local.has(copy) || remote.has(copy)) copy = conflictCopyName(path, `${options.machineName} ${n++}`, now())
          await atomicWrite(join(root, ...copy.split('/')), ours)
          await atomicWrite(join(root, ...path.split('/')), remoteBytes)
          record(path, hashContent(remoteBytes), remote.get(path))
          report.conflicts.push(copy)
          report.pulled.push(path)
          if (!pushBlocked) {
            const entry = await store.write(copy, ours)
            record(copy, hashContent(ours), entry)
            changedRemote.push(copy)
          }
          break
        }
      }
    }
    await store.commit({ changed: changedRemote, removed: removedRemote })
    report.at = now().toISOString()
    return { report, state: next }
  } finally {
    await store.close()
  }
}
