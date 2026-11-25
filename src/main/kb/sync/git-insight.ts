import { git, splitZ, tryGit } from './git-space'
import { safeRemoteLinks } from '../../../shared/kb/git-remote'
import type { KbFileChange, KbGitCommit, KbGitCommitDetail, KbGitOverview } from '../../../shared/kb/types'

const FILES_PER_COMMIT = 20
const PENDING_LIMIT = 200
const FIELDS = '%H%x1f%P%x1f%aI%x1f%an%x1f%ae%x1f%s'
const HASH = /^[0-9a-f]{7,64}$/i

type CommitHeader = Omit<KbGitCommit, 'pushed' | 'files' | 'fileCount'> & { firstParent: string | null }

function statusOf(code: string): KbFileChange['status'] {
  if (code.startsWith('A')) return 'added'
  if (code.startsWith('D')) return 'deleted'
  return 'modified'
}

function parseHeader(line: string): CommitHeader {
  const [hash, parents, date, author, email, ...subject] = line.split('\x1f')
  const parentList = parents.split(' ').filter(Boolean)
  return {
    hash,
    merge: parentList.length > 1,
    firstParent: parentList[0] ?? null,
    date,
    author,
    email,
    subject: subject.join(' ')
  }
}

function parseNameStatus(tokens: string[]): KbFileChange[] {
  const files: KbFileChange[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) files.push({ status: statusOf(tokens[i].trim()), path: tokens[i + 1] })
  return files
}

function remoteRefOf(branch: string): string {
  return `refs/remotes/origin/${branch}`
}

async function resolveRef(root: string, ref: string): Promise<string | null> {
  const r = await tryGit(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])
  return r.ok ? r.out.trim() : null
}

async function count(root: string, range: string): Promise<number> {
  const r = await tryGit(root, ['rev-list', '--count', range])
  return r.ok ? Number(r.out.trim()) : 0
}

async function unpushed(root: string, remoteHead: string | null): Promise<Set<string> | null> {
  if (!remoteHead) return null
  const out = await tryGit(root, ['rev-list', `${remoteHead}..HEAD`])
  return new Set(out.ok ? out.out.split('\n').filter(Boolean) : [])
}

export async function listCommits(root: string, branch: string, limit = 30, skip = 0): Promise<KbGitCommit[]> {
  const out = await tryGit(root, [
    'log',
    `-n${limit}`,
    `--skip=${skip}`,
    '--no-renames',
    '--name-status',
    '-z',
    `--format=%x1e${FIELDS}`,
    'HEAD'
  ])
  if (!out.ok) return []
  const local = await unpushed(root, await resolveRef(root, remoteRefOf(branch)))
  return out.out
    .split('\x1e')
    .slice(1)
    .map((record) => {
      const [line, ...rest] = record.split('\0')
      const { firstParent: _firstParent, ...header } = parseHeader(line.trim())
      const files = parseNameStatus(rest.filter((t) => t.trim().length > 0))
      return {
        ...header,
        pushed: local !== null && !local.has(header.hash),
        files: files.slice(0, FILES_PER_COMMIT),
        fileCount: files.length
      }
    })
}

export async function commitDetail(root: string, branch: string, commit: string): Promise<KbGitCommitDetail> {
  if (!HASH.test(commit)) throw new Error('Invalid commit')
  const hash = await resolveRef(root, commit)
  if (!hash) throw new Error(`Commit not found: ${commit.slice(0, 8)}`)
  const { firstParent, ...header } = parseHeader((await git(root, ['show', '-s', `--format=${FIELDS}`, hash])).trim())
  const body = (await git(root, ['show', '-s', '--format=%b', hash])).trim()
  const range = firstParent ? [firstParent, hash] : ['--root', '--no-commit-id', hash]
  const changes = async (kind: string): Promise<string> => git(root, ['diff-tree', '-r', '--no-renames', '-z', kind, ...range])
  const files = parseNameStatus(splitZ(await changes('--name-status')))
  const lines = new Map<string, { added: number | null; removed: number | null }>()
  for (const entry of splitZ(await changes('--numstat'))) {
    const [added, removed, ...path] = entry.split('\t')
    lines.set(path.join('\t'), { added: added === '-' ? null : Number(added), removed: removed === '-' ? null : Number(removed) })
  }
  const local = await unpushed(root, await resolveRef(root, remoteRefOf(branch)))
  return {
    ...header,
    body,
    pushed: local !== null && !local.has(hash),
    files: files.map((f) => ({ ...f, ...lines.get(f.path) })),
    fileCount: files.length
  }
}

export async function pendingFiles(root: string): Promise<KbFileChange[]> {
  const out = await tryGit(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])
  if (!out.ok) return []
  return splitZ(out.out).map((entry) => {
    const code = entry.slice(0, 2)
    const status = code === '??' || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified'
    return { path: entry.slice(3), status }
  })
}

export async function gitOverview(root: string, branch: string, remoteUrl: string): Promise<KbGitOverview> {
  const remoteHead = await resolveRef(root, remoteRefOf(branch))
  const [head] = await listCommits(root, branch, 1)
  const pending = await pendingFiles(root)
  return {
    branch,
    remote: safeRemoteLinks(remoteUrl),
    head: head ?? null,
    remoteHead,
    ahead: head ? await count(root, remoteHead ? `${remoteHead}..HEAD` : 'HEAD') : 0,
    behind: head && remoteHead ? await count(root, `HEAD..${remoteHead}`) : 0,
    commits: head ? await count(root, 'HEAD') : 0,
    pending: pending.slice(0, PENDING_LIMIT),
    pendingCount: pending.length
  }
}
