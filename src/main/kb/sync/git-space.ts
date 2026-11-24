import { existsSync, promises as fs, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { execGit, execGitText, GitExecError } from '../../git/git-exec'
import { scanText, isScannable, type SecretFinding } from '../secrets/scanner'
import type { KbSyncReport } from '../../../shared/kb/types'

export const GITIGNORE_LINES = [
  '.obsidian/workspace*.json',
  '.obsidian/cache',
  '.trash/',
  '.DS_Store',
  'Thumbs.db',
  '*.sge-tmp',
  '.sge-kb/local/'
]

const REMOTE = 'origin'

export interface GitSpaceOptions {
  branch: string
  machineName: string
  childDirs?: string[]
  allowPush?: () => { ok: true } | { ok: false; reason: 'review' | 'locked' | 'readonly'; message: string }
  blockSecrets: boolean
  now?: () => Date
}

export function emptyReport(): KbSyncReport {
  return {
    at: new Date().toISOString(),
    ok: true,
    pulled: [],
    pushed: [],
    conflicts: [],
    deletedLocal: [],
    deletedRemote: [],
    secrets: [],
    blockedBy: null,
    message: null
  }
}

async function git(root: string, args: string[], okCodes?: number[]): Promise<string> {
  const result = await execGit(args, { cwd: root, okCodes })
  return result.stdout.toString('utf-8')
}

async function tryGit(root: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const result = await execGit(args, { cwd: root })
    return { ok: true, out: result.stdout.toString('utf-8'), err: result.stderr }
  } catch (error) {
    if (error instanceof GitExecError) return { ok: false, out: '', err: error.stderr }
    throw error
  }
}

export async function isRepoRoot(root: string): Promise<boolean> {
  if (!existsSync(join(root, '.git'))) return false
  const top = await tryGit(root, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return false
  const { realpathSync } = await import('fs')
  try {
    return realpathSync.native(top.out.trim()) === realpathSync.native(root)
  } catch {
    return resolve(top.out.trim()) === resolve(root)
  }
}

function ensureLines(file: string, lines: string[], header: string): boolean {
  const current = existsSync(file) ? readFileSync(file, 'utf-8') : ''
  const present = new Set(current.split(/\r?\n/).map((l) => l.trim()))
  const missing = lines.filter((l) => !present.has(l))
  if (missing.length === 0) return false
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  const block = `${prefix}${current.length > 0 ? '\n' : ''}${header}\n${missing.join('\n')}\n`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, current + block, 'utf-8')
  return true
}

async function hasIdentity(root: string): Promise<boolean> {
  const email = await tryGit(root, ['config', 'user.email'])
  return email.ok && email.out.trim().length > 0
}

export async function ensureRepo(root: string, remoteUrl: string, branch: string, childDirs: string[] = []): Promise<void> {
  if (!(await isRepoRoot(root))) {
    await git(root, ['init', '-q', '-b', branch])
  }
  await git(root, ['config', 'core.quotepath', 'false'])
  if (!(await hasIdentity(root))) {
    await git(root, ['config', 'user.name', 'SincroGitExclude'])
    await git(root, ['config', 'user.email', 'sincrogitexclude@localhost'])
  }
  ensureLines(join(root, '.gitignore'), GITIGNORE_LINES, '# SincroGitExclude knowledge base')
  const excludePath = resolve(root, (await git(root, ['rev-parse', '--git-path', 'info/exclude'])).trim())
  if (childDirs.length > 0) {
    ensureLines(excludePath, childDirs.map((d) => `/${d.replace(/^\/+|\/+$/g, '')}/`), '# SincroGitExclude nested knowledge spaces')
  }
  if (remoteUrl) {
    const current = await tryGit(root, ['remote', 'get-url', REMOTE])
    if (!current.ok) await git(root, ['remote', 'add', REMOTE, remoteUrl])
    else if (current.out.trim() !== remoteUrl) await git(root, ['remote', 'set-url', REMOTE, remoteUrl])
  }
}

export async function cloneSpace(remoteUrl: string, target: string, branch: string): Promise<void> {
  if (existsSync(target) && (await fs.readdir(target)).length > 0) {
    throw new Error(`The destination is not empty: ${target}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  const parent = dirname(target)
  await execGit(['clone', '-q', '--origin', REMOTE, remoteUrl, target], { cwd: parent })
  const branches = await tryGit(target, ['rev-parse', '--verify', '-q', `refs/remotes/${REMOTE}/${branch}`])
  if (branches.ok) await git(target, ['checkout', '-q', '-B', branch, `${REMOTE}/${branch}`])
}

async function headOf(root: string): Promise<string | null> {
  const r = await tryGit(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  return r.ok ? r.out.trim() : null
}

async function refOf(root: string, ref: string): Promise<string | null> {
  const r = await tryGit(root, ['rev-parse', '--verify', '-q', ref])
  return r.ok ? r.out.trim() : null
}

function splitZ(out: string): string[] {
  return out.split('\0').filter((s) => s.length > 0)
}

export async function commitAll(root: string, message: string): Promise<string[]> {
  await git(root, ['add', '-A'])
  const staged = splitZ(await git(root, ['diff', '--cached', '--name-only', '-z']))
  if (staged.length === 0) return []
  await git(root, ['commit', '-q', '--no-verify', '-m', message])
  return staged
}

export function conflictCopyName(path: string, machine: string, when: Date): string {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const file = path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}`
  const safeMachine = machine.replace(/[\\/:*?"<>|]/g, '-').trim() || 'machine'
  return `${dir}${stem} (conflict ${safeMachine} ${stamp})${ext}`
}

async function resolveConflicts(root: string, machine: string, when: Date): Promise<string[]> {
  const unmerged = splitZ(await git(root, ['diff', '--name-only', '--diff-filter=U', '-z']))
  const copies: string[] = []
  for (const path of unmerged) {
    const stages = new Set(
      (await git(root, ['ls-files', '-u', '-z', '--', path]))
        .split('\0')
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[2])
    )
    if (stages.has('2') && stages.has('3')) {
      const ours = (await execGit(['show', `:2:${path}`], { cwd: root })).stdout
      let copy = conflictCopyName(path, machine, when)
      let n = 2
      while (existsSync(join(root, ...copy.split('/')))) copy = conflictCopyName(path, `${machine} ${n++}`, when)
      const full = join(root, ...copy.split('/'))
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, ours)
      await git(root, ['checkout', '--theirs', '--', path])
      await git(root, ['add', '--', path, copy])
      copies.push(copy)
    } else if (stages.has('3')) {
      await git(root, ['checkout', '--theirs', '--', path])
      await git(root, ['add', '--', path])
    } else {
      await git(root, ['checkout', '--ours', '--', path])
      await git(root, ['add', '--', path])
    }
  }
  return copies
}

async function changedBetween(root: string, from: string | null, to: string): Promise<string[]> {
  if (!from) return splitZ(await git(root, ['ls-tree', '-r', '--name-only', '-z', to]))
  if (from === to) return []
  return splitZ(await git(root, ['diff', '--name-only', '-z', from, to]))
}

async function scanOutgoing(root: string, base: string | null, head: string): Promise<Array<SecretFinding & { path: string }>> {
  const paths = base
    ? splitZ(await git(root, ['diff', '--name-only', '--diff-filter=AM', '-z', base, head]))
    : splitZ(await git(root, ['ls-tree', '-r', '--name-only', '-z', head]))
  const findings: Array<SecretFinding & { path: string }> = []
  for (const path of paths) {
    const full = join(root, ...path.split('/'))
    if (!existsSync(full)) continue
    const size = statSync(full).size
    if (!isScannable(path, size)) continue
    for (const f of scanText(readFileSync(full, 'utf-8'))) findings.push({ ...f, path })
  }
  return findings
}

export async function syncGitSpace(root: string, options: GitSpaceOptions): Promise<KbSyncReport> {
  const report = emptyReport()
  const now = options.now ?? (() => new Date())
  const branch = options.branch
  const remoteRef = `refs/remotes/${REMOTE}/${branch}`

  await commitAll(root, `Update notes (${options.machineName})`)

  const fetched = await tryGit(root, ['fetch', '-q', REMOTE, `+refs/heads/${branch}:${remoteRef}`])
  const remoteHead = fetched.ok ? await refOf(root, remoteRef) : null
  if (!fetched.ok && !/couldn't find remote ref|could not find remote ref/i.test(fetched.err)) {
    report.ok = false
    report.message = `fetch failed: ${fetched.err.trim()}`
    return report
  }

  const before = await headOf(root)
  if (remoteHead && before !== remoteHead) {
    const isAncestor = before
      ? (await tryGit(root, ['merge-base', '--is-ancestor', before, remoteHead])).ok
      : false
    const remoteIsAncestor = before
      ? (await tryGit(root, ['merge-base', '--is-ancestor', remoteHead, before])).ok
      : false
    if (!before) {
      await git(root, ['reset', '-q', '--hard', remoteHead])
    } else if (isAncestor) {
      await git(root, ['merge', '-q', '--ff-only', remoteHead])
    } else if (!remoteIsAncestor) {
      const merge = await tryGit(root, [
        'merge',
        '-q',
        '--no-edit',
        '--allow-unrelated-histories',
        '-m',
        `Merge notes from the remote (${options.machineName})`,
        remoteHead
      ])
      if (!merge.ok) {
        const copies = await resolveConflicts(root, options.machineName, now())
        report.conflicts.push(...copies)
        await git(root, ['commit', '-q', '--no-verify', '--no-edit'])
      }
    }
    if (!remoteIsAncestor) {
      const base = before ? await tryGit(root, ['merge-base', before, remoteHead]) : null
      report.pulled = await changedBetween(root, base?.ok ? base.out.trim() : null, remoteHead)
    }
  }

  const head = await headOf(root)
  if (!head) {
    report.message = 'Nothing to sync yet: the space has no notes committed.'
    return report
  }
  const outgoing = await changedBetween(root, remoteHead, head)
  if (remoteHead && (await tryGit(root, ['merge-base', '--is-ancestor', head, remoteHead])).ok) {
    report.at = now().toISOString()
    return report
  }

  const findings = await scanOutgoing(root, remoteHead, head)
  report.secrets = findings.map((f) => ({ path: f.path, rule: f.rule, line: f.line }))
  if (findings.length > 0 && options.blockSecrets) {
    report.ok = false
    report.blockedBy = 'secrets'
    report.message = 'Push blocked: possible secrets in the outgoing notes. Remove them or mark the line with sge-kb:allow-secret.'
    return report
  }
  const gate = options.allowPush?.() ?? { ok: true as const }
  if (!gate.ok) {
    report.blockedBy = gate.reason
    report.message = gate.message
    return report
  }

  const push = await tryGit(root, ['push', '-q', REMOTE, `HEAD:refs/heads/${branch}`])
  if (!push.ok) {
    report.ok = false
    report.message = /rejected|non-fast-forward|fetch first/i.test(push.err)
      ? 'The remote moved while syncing. Sync again to merge the new notes.'
      : `push failed: ${push.err.trim()}`
    return report
  }
  await tryGit(root, ['update-ref', remoteRef, head])
  report.pushed = outgoing
  report.at = now().toISOString()
  return report
}

export interface HistoryEntry {
  hash: string
  date: string
  author: string
  subject: string
}

export async function noteHistory(root: string, path: string, limit = 100): Promise<HistoryEntry[]> {
  const out = await tryGit(root, ['log', '--follow', `-n${limit}`, '--format=%H%x1f%aI%x1f%an%x1f%s%x1e', '--', path])
  if (!out.ok) return []
  return out.out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, date, author, subject] = r.split('\x1f')
      return { hash, date, author, subject }
    })
}

export async function noteAt(root: string, commit: string, path: string): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error('Invalid commit')
  const out = await tryGit(root, ['show', `${commit}:${path}`])
  if (out.ok) return out.out
  const renamed = await execGitText(['log', '--follow', '--name-only', '--format=', `${commit}`, '-n1', '--', path], { cwd: root })
  const old = renamed.trim().split('\n').filter(Boolean)[0]
  if (!old) throw new Error(`The note did not exist at ${commit.slice(0, 8)}`)
  return git(root, ['show', `${commit}:${old}`])
}

export async function noteDiff(root: string, commit: string, path: string): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error('Invalid commit')
  return git(root, ['show', '--format=', '--patch', '--find-renames', commit, '--', path])
}

export async function workingChanges(root: string): Promise<string[]> {
  const out = await tryGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (!out.ok) return []
  return splitZ(out.out).map((entry) => entry.slice(3))
}
