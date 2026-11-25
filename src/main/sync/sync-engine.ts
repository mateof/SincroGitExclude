import { existsSync, mkdirSync } from 'fs'
import { execGit, execGitText, GitExecError } from '../git/git-exec'
import { COMMITTER_ENV, syncCheckedOutBranch } from '../git/deployed-tree'

export const META_REF = 'refs/heads/sge/meta'
export const LOCAL_META_REF = 'refs/sge/meta'
export const REMOTE_BRANCH_PREFIX = 'refs/remotes/sge/'
export const REMOTE_TAG_PREFIX = 'refs/remotes/sge-tags/'
const META_FILE = 'meta.json'

export function remoteFilePrefix(fileId: string): string {
  return `refs/heads/sge/files/${fileId}/`
}

export function remoteFileTagPrefix(fileId: string): string {
  return `refs/tags/sge/files/${fileId}/`
}

export interface MetaFile {
  id: string
  name: string
  alias: string
  type: string
  useAutoIcon: boolean
  ignorePatterns: string
  tags: Array<{ name: string; color: string }>
  createdAt: string
  updatedAt: string
}

export interface MetaDeployment {
  id: string
  fileId: string
  branch: string
  repoPath: string
  relativePath: string
  description: string | null
  isActive: boolean
}

export interface MetaMachine {
  name: string
  updatedAt: string
  deployments: MetaDeployment[]
}

export interface SyncMeta {
  version: 1
  files: Record<string, MetaFile>
  tombstones: Record<string, string>
  machines: Record<string, MetaMachine>
}

export interface LocalMetaInput {
  files: MetaFile[]
  tombstones: Record<string, string>
  machineId: string
  machine: MetaMachine
}

export type BranchState = 'fast-forwarded' | 'behind' | 'ahead' | 'diverged'

export interface BranchReport {
  branch: string
  state: BranchState
}

export interface PushFileResult {
  status: 'up-to-date' | 'pushed' | 'conflict'
  rejected: Array<{ ref: string; reason: string }>
}

export class MetaConflictError extends Error {
  constructor() {
    super('The remote metadata changed while pushing')
    this.name = 'MetaConflictError'
  }
}

export function emptyMeta(): SyncMeta {
  return { version: 1, files: {}, tombstones: {}, machines: {} }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    )
  }
  return value
}

export function serializeMeta(meta: SyncMeta): string {
  return JSON.stringify(sortKeys(meta), null, 2) + '\n'
}

export function mergeMeta(remote: SyncMeta | null, local: LocalMetaInput): SyncMeta {
  const base = remote ?? emptyMeta()
  const files: Record<string, MetaFile> = { ...base.files }
  for (const file of local.files) {
    const existing = files[file.id]
    if (!existing || existing.updatedAt <= file.updatedAt) files[file.id] = file
  }

  const tombstones: Record<string, string> = { ...base.tombstones }
  for (const [id, at] of Object.entries(local.tombstones)) {
    if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at
  }
  for (const [id, deletedAt] of Object.entries(tombstones)) {
    if (files[id] && files[id].updatedAt <= deletedAt) delete files[id]
  }

  return {
    version: 1,
    files,
    tombstones,
    machines: { ...base.machines, [local.machineId]: local.machine }
  }
}

export async function lsRemote(url: string, cwd: string): Promise<Map<string, string>> {
  const raw = await execGitText(['ls-remote', url], { cwd })
  const refs = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const [sha, ref] = line.split('\t')
    if (sha && ref && !ref.endsWith('^{}')) refs.set(ref, sha)
  }
  return refs
}

async function localRefs(repo: string): Promise<Map<string, string>> {
  const raw = await execGitText(
    ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags'],
    { cwd: repo }
  )
  const refs = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const space = line.indexOf(' ')
    if (space > 0) refs.set(line.slice(space + 1), line.slice(0, space))
  }
  return refs
}

function remoteNameFor(fileId: string, localRef: string): string | null {
  if (localRef.startsWith('refs/heads/')) {
    return remoteFilePrefix(fileId) + localRef.slice('refs/heads/'.length)
  }
  if (localRef.startsWith('refs/tags/')) {
    return remoteFileTagPrefix(fileId) + localRef.slice('refs/tags/'.length)
  }
  return null
}

export async function pushFile(
  repo: string,
  url: string,
  fileId: string,
  remoteRefs: Map<string, string>
): Promise<PushFileResult> {
  const local = await localRefs(repo)
  const pending = [...local].filter(([ref, sha]) => {
    const remoteName = remoteNameFor(fileId, ref)
    return remoteName !== null && remoteRefs.get(remoteName) !== sha
  })
  if (pending.length === 0) return { status: 'up-to-date', rejected: [] }

  const result = await execGit(
    [
      'push',
      '--porcelain',
      url,
      `refs/heads/*:${remoteFilePrefix(fileId)}*`,
      `refs/tags/*:${remoteFileTagPrefix(fileId)}*`
    ],
    { cwd: repo, okCodes: [0, 1] }
  )

  const rejected: Array<{ ref: string; reason: string }> = []
  for (const line of result.stdout.toString('utf-8').split('\n')) {
    const match = /^(.)\t([^\t]*)\t(.*)$/.exec(line)
    if (match && match[1] === '!') {
      rejected.push({ ref: match[2].split(':')[0], reason: match[3] })
    }
  }

  if (result.code !== 0 && rejected.length === 0) {
    throw new GitExecError(['push'], result.code, result.stderr)
  }
  return { status: rejected.length > 0 ? 'conflict' : 'pushed', rejected }
}

export async function fetchFile(repo: string, url: string, fileId: string): Promise<void> {
  await execGit(
    [
      'fetch',
      '--prune',
      '--no-tags',
      '--quiet',
      url,
      `+${remoteFilePrefix(fileId)}*:${REMOTE_BRANCH_PREFIX}*`,
      `+${remoteFileTagPrefix(fileId)}*:${REMOTE_TAG_PREFIX}*`
    ],
    { cwd: repo }
  )
}

async function refsUnder(repo: string, prefix: string): Promise<Map<string, string>> {
  const raw = await execGitText(['for-each-ref', '--format=%(objectname) %(refname)', prefix], {
    cwd: repo
  })
  const refs = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const space = line.indexOf(' ')
    if (space > 0) refs.set(line.slice(space + 1 + prefix.length), line.slice(0, space))
  }
  return refs
}

async function isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
  const result = await execGit(['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: repo,
    okCodes: [0, 1]
  })
  return result.code === 0
}

export async function integrateFile(
  repo: string,
  protectedBranches: Set<string>
): Promise<BranchReport[]> {
  const remote = await refsUnder(repo, REMOTE_BRANCH_PREFIX)
  const local = await refsUnder(repo, 'refs/heads/')
  const reports: BranchReport[] = []

  for (const [branch, remoteSha] of remote) {
    const localSha = local.get(branch)
    if (!localSha || localSha === remoteSha) continue

    if (await isAncestor(repo, localSha, remoteSha)) {
      if (protectedBranches.has(branch)) {
        reports.push({ branch, state: 'behind' })
        continue
      }
      await execGit(['update-ref', `refs/heads/${branch}`, remoteSha, localSha], { cwd: repo })
      await syncCheckedOutBranch(repo, branch)
      reports.push({ branch, state: 'fast-forwarded' })
    } else if (await isAncestor(repo, remoteSha, localSha)) {
      reports.push({ branch, state: 'ahead' })
    } else {
      reports.push({ branch, state: 'diverged' })
    }
  }
  return reports
}

export async function cloneFile(repo: string, url: string, fileId: string): Promise<string> {
  mkdirSync(repo, { recursive: true })
  await execGit(['init', '-q'], { cwd: repo })
  for (const [key, value] of [
    ['user.name', COMMITTER_ENV.GIT_AUTHOR_NAME],
    ['user.email', COMMITTER_ENV.GIT_AUTHOR_EMAIL],
    ['core.longpaths', 'true'],
    ['core.fileMode', 'false']
  ]) {
    await execGit(['config', key, value], { cwd: repo })
  }
  await fetchFile(repo, url, fileId)

  const branches = [...(await refsUnder(repo, REMOTE_BRANCH_PREFIX)).keys()]
  const base =
    ['master', 'main'].find((b) => branches.includes(b)) ??
    branches.find((b) => !b.startsWith('deploy-')) ??
    branches[0]
  if (!base) throw new Error(`The remote has no history for file ${fileId}`)

  await execGit(['checkout', '-q', '-b', base, `${REMOTE_BRANCH_PREFIX}${base}`], { cwd: repo })
  return base
}

async function initMetaRepo(metaRepo: string): Promise<void> {
  mkdirSync(metaRepo, { recursive: true })
  if (!existsSync(`${metaRepo}/HEAD`)) await execGit(['init', '--bare', '-q'], { cwd: metaRepo })
}

export async function fetchMeta(
  metaRepo: string,
  url: string,
  remoteRefs: Map<string, string>
): Promise<{ meta: SyncMeta | null; parent: string | null }> {
  await initMetaRepo(metaRepo)
  const remoteSha = remoteRefs.get(META_REF)
  if (!remoteSha) return { meta: null, parent: null }

  await execGit(['fetch', '--no-tags', '--quiet', url, `+${META_REF}:${LOCAL_META_REF}`], {
    cwd: metaRepo
  })
  const meta = await readLocalMeta(metaRepo)
  return { meta, parent: remoteSha }
}

export async function readLocalMeta(metaRepo: string): Promise<SyncMeta | null> {
  if (!existsSync(`${metaRepo}/HEAD`)) return null
  try {
    const raw = await execGitText(['cat-file', 'blob', `${LOCAL_META_REF}:${META_FILE}`], {
      cwd: metaRepo
    })
    const parsed = JSON.parse(raw) as Partial<SyncMeta>
    return {
      version: 1,
      files: parsed.files ?? {},
      tombstones: parsed.tombstones ?? {},
      machines: parsed.machines ?? {}
    }
  } catch {
    return null
  }
}

export async function pushMeta(
  metaRepo: string,
  url: string,
  meta: SyncMeta,
  parent: string | null,
  message: string
): Promise<string> {
  await initMetaRepo(metaRepo)
  const blob = (
    await execGitText(['hash-object', '-w', '--stdin'], { cwd: metaRepo, input: serializeMeta(meta) })
  ).trim()
  const tree = (
    await execGitText(['mktree'], { cwd: metaRepo, input: `100644 blob ${blob}\t${META_FILE}\n` })
  ).trim()
  const commit = (
    await execGitText(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], {
      cwd: metaRepo,
      env: COMMITTER_ENV,
      input: message
    })
  ).trim()

  const result = await execGit(['push', '--porcelain', url, `${commit}:${META_REF}`], {
    cwd: metaRepo,
    okCodes: [0, 1]
  })
  if (result.code !== 0) {
    if (result.stdout.toString('utf-8').split('\n').some((l) => l.startsWith('!'))) {
      throw new MetaConflictError()
    }
    throw new GitExecError(['push'], result.code, result.stderr)
  }
  await execGit(['update-ref', LOCAL_META_REF, commit], { cwd: metaRepo })
  return commit
}

export async function remoteBranchesOf(repo: string): Promise<Map<string, string>> {
  return refsUnder(repo, REMOTE_BRANCH_PREFIX)
}

export async function remoteTagsOf(repo: string): Promise<Map<string, string>> {
  const raw = await execGitText(
    ['for-each-ref', '--format=%(objectname) %(*objectname) %(refname)', REMOTE_TAG_PREFIX],
    { cwd: repo }
  )
  const tags = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const [direct, peeled, ref] = line.split(' ')
    if (!direct || !ref) continue
    tags.set(peeled || direct, ref.slice(REMOTE_TAG_PREFIX.length))
  }
  return tags
}
