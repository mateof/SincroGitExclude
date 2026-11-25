import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { execGit, execGitText } from './git-exec'
import { matchesAnyPattern, scanDirectory, toGitignoreLines } from '../utils/file-scanner'

export interface DeployedTree {
  repoPath: string
  workTree: string
  branch: string
  indexFile: string
  ignorePatterns: string[]
}

export type ChangeKind = 'modified' | 'added' | 'deleted'

export interface WorkTreeChange {
  path: string
  kind: ChangeKind
}

export interface ChangeWithStats extends WorkTreeChange {
  additions: number
  deletions: number
}

export const COMMITTER_ENV = {
  GIT_AUTHOR_NAME: 'SincroGitExclude',
  GIT_AUTHOR_EMAIL: 'sincrogitexclude@local',
  GIT_COMMITTER_NAME: 'SincroGitExclude',
  GIT_COMMITTER_EMAIL: 'sincrogitexclude@local'
}

const INDEX_DIR = 'sge-index'

function indexDir(repoPath: string): string {
  return join(repoPath, '.git', INDEX_DIR)
}

export function deployedTree(
  repoPath: string,
  deploymentId: string,
  workTree: string,
  branch: string,
  ignorePatterns: string[]
): DeployedTree {
  return {
    repoPath,
    workTree,
    branch,
    indexFile: join(indexDir(repoPath), deploymentId),
    ignorePatterns
  }
}

export function removeDeployedIndex(repoPath: string, deploymentId: string): void {
  const base = join(indexDir(repoPath), deploymentId)
  for (const suffix of ['', '.head', '.exclude', '.lock']) {
    rmSync(base + suffix, { force: true })
  }
}

function excludesFile(tree: DeployedTree): string {
  const path = `${tree.indexFile}.exclude`
  const content = toGitignoreLines(tree.ignorePatterns).join('\n') + '\n'
  const current = existsSync(path) ? readFileSync(path, 'utf-8') : null
  if (current !== content) {
    mkdirSync(indexDir(tree.repoPath), { recursive: true })
    writeFileSync(path, content, 'utf-8')
  }
  return path
}

function envFor(tree: DeployedTree, indexFile = tree.indexFile): Record<string, string> {
  return {
    GIT_DIR: join(tree.repoPath, '.git'),
    GIT_WORK_TREE: tree.workTree,
    GIT_INDEX_FILE: indexFile
  }
}

function run(
  tree: DeployedTree,
  args: string[],
  options: { indexFile?: string; input?: Buffer | string; env?: Record<string, string> } = {}
): Promise<Buffer> {
  return execGit(['-c', `core.excludesFile=${excludesFile(tree)}`, '-c', 'core.quotePath=false', ...args], {
    cwd: tree.workTree,
    env: { ...envFor(tree, options.indexFile), ...options.env },
    input: options.input
  }).then((r) => r.stdout)
}

async function branchHead(tree: DeployedTree): Promise<string> {
  return (
    await execGitText(['rev-parse', '--verify', `refs/heads/${tree.branch}^{commit}`], {
      cwd: tree.repoPath
    })
  ).trim()
}

export async function ensureIndex(tree: DeployedTree): Promise<string> {
  const head = await branchHead(tree)
  const marker = `${tree.indexFile}.head`
  const markerValue = existsSync(marker) ? readFileSync(marker, 'utf-8').trim() : null
  if (existsSync(tree.indexFile) && markerValue === head) return head

  mkdirSync(indexDir(tree.repoPath), { recursive: true })
  rmSync(marker, { force: true })
  if (existsSync(tree.indexFile)) {
    try {
      await run(tree, ['read-tree', '-m', head])
    } catch {
      rmSync(tree.indexFile, { force: true })
      await run(tree, ['read-tree', head])
    }
  } else {
    await run(tree, ['read-tree', head])
  }
  writeFileSync(marker, head, 'utf-8')
  return head
}

function invalidateIndex(tree: DeployedTree): void {
  rmSync(`${tree.indexFile}.head`, { force: true })
}

function parseStatusZ(raw: Buffer): Array<{ code: string; path: string }> {
  const entries: Array<{ code: string; path: string }> = []
  for (const item of raw.toString('utf-8').split('\0')) {
    if (item.length < 4) continue
    entries.push({ code: item.slice(0, 2), path: item.slice(3) })
  }
  return entries
}

export async function listChanges(tree: DeployedTree): Promise<WorkTreeChange[]> {
  if (!existsSync(tree.workTree)) return []
  await ensureIndex(tree)
  const raw = await run(tree, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching',
    '--no-renames'
  ])

  const byPath = new Map<string, ChangeKind>()
  const add = (path: string, kind: ChangeKind): void => {
    if (!matchesAnyPattern(path, tree.ignorePatterns)) byPath.set(path, kind)
  }

  for (const { code, path } of parseStatusZ(raw)) {
    if (code === '!!') {
      const relDir = path.endsWith('/') ? path.slice(0, -1) : null
      if (relDir === null) {
        add(path, 'added')
      } else if (!matchesAnyPattern(relDir, tree.ignorePatterns)) {
        for (const file of scanDirectory(tree.workTree, tree.ignorePatterns, join(tree.workTree, relDir))) {
          add(file, 'added')
        }
      }
      continue
    }
    if (code === '??') {
      if (!path.endsWith('/')) add(path, 'added')
      continue
    }
    const worktreeState = code[1]
    if (worktreeState === 'D') add(path, 'deleted')
    else if (worktreeState === 'M' || worktreeState === 'T') add(path, 'modified')
  }

  return [...byPath.entries()]
    .map(([path, kind]) => ({ path, kind }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export async function hasChanges(tree: DeployedTree): Promise<boolean> {
  return (await listChanges(tree)).length > 0
}

async function stage(tree: DeployedTree, indexFile: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await run(tree, ['add', '-A', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    indexFile,
    input: paths.join('\0'),
    env: { GIT_LITERAL_PATHSPECS: '1' }
  })
}

async function withTempIndex<T>(
  tree: DeployedTree,
  seedFromDeploymentIndex: boolean,
  fn: (indexFile: string) => Promise<T>
): Promise<T> {
  const temp = join(indexDir(tree.repoPath), `tmp-${randomUUID()}`)
  mkdirSync(indexDir(tree.repoPath), { recursive: true })
  if (seedFromDeploymentIndex && existsSync(tree.indexFile)) copyFileSync(tree.indexFile, temp)
  try {
    return await fn(temp)
  } finally {
    rmSync(temp, { force: true })
    rmSync(`${temp}.lock`, { force: true })
  }
}

export async function diffWorking(tree: DeployedTree): Promise<string> {
  const changes = await listChanges(tree)
  if (changes.length === 0) return ''
  return withTempIndex(tree, true, async (temp) => {
    await stage(tree, temp, changes.map((c) => c.path))
    const patch = await run(tree, ['diff', '--cached', '--no-renames', `refs/heads/${tree.branch}`], {
      indexFile: temp
    })
    return patch.toString('utf-8')
  })
}

export async function listChangesWithStats(tree: DeployedTree): Promise<ChangeWithStats[]> {
  const changes = await listChanges(tree)
  if (changes.length === 0) return []
  const numstat = await withTempIndex(tree, true, async (temp) => {
    await stage(tree, temp, changes.map((c) => c.path))
    return run(tree, ['diff', '--cached', '--no-renames', '--numstat', '-z', `refs/heads/${tree.branch}`], {
      indexFile: temp
    })
  })

  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const item of numstat.toString('utf-8').split('\0')) {
    const [add, del, ...rest] = item.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    stats.set(path, {
      additions: add === '-' ? 0 : parseInt(add, 10) || 0,
      deletions: del === '-' ? 0 : parseInt(del, 10) || 0
    })
  }

  return changes.map((c) => ({ ...c, ...(stats.get(c.path) ?? { additions: 0, deletions: 0 }) }))
}

export async function commitChanges(
  tree: DeployedTree,
  message: string,
  onlyPaths?: string[]
): Promise<string> {
  const changes = await listChanges(tree)
  const wanted = onlyPaths ? new Set(onlyPaths) : null
  const paths = changes.map((c) => c.path).filter((p) => !wanted || wanted.has(p))
  if (paths.length === 0) throw new Error('No changes to commit')

  const head = await ensureIndex(tree)
  try {
    await stage(tree, tree.indexFile, paths)
    const treeHash = (await run(tree, ['write-tree'])).toString('utf-8').trim()
    const headTree = (
      await execGitText(['rev-parse', `${head}^{tree}`], { cwd: tree.repoPath })
    ).trim()
    if (treeHash === headTree) throw new Error('No changes to commit')

    const commit = (
      await execGitText(['commit-tree', treeHash, '-p', head, '-F', '-'], {
        cwd: tree.repoPath,
        env: COMMITTER_ENV,
        input: message
      })
    ).trim()
    await execGitText(['update-ref', `refs/heads/${tree.branch}`, commit, head], {
      cwd: tree.repoPath
    })
    writeFileSync(`${tree.indexFile}.head`, commit, 'utf-8')
    await syncCheckedOutBranch(tree.repoPath, tree.branch)
    return commit
  } catch (error) {
    invalidateIndex(tree)
    throw error
  }
}

export async function syncCheckedOutBranch(repoPath: string, branch: string): Promise<void> {
  const current = await execGit(['symbolic-ref', '-q', 'HEAD'], { cwd: repoPath, okCodes: [0, 1] })
  if (current.stdout.toString('utf-8').trim() === `refs/heads/${branch}`) {
    await execGit(['reset', '--hard', '-q'], { cwd: repoPath })
  }
}

export async function restoreFromCommit(
  tree: DeployedTree,
  commit: string,
  paths?: string[]
): Promise<void> {
  mkdirSync(tree.workTree, { recursive: true })
  await withTempIndex(tree, false, async (temp) => {
    if (paths === undefined) {
      await run(tree, ['checkout', commit, '--', '.'], { indexFile: temp })
    } else if (paths.length > 0) {
      await run(tree, ['checkout', commit, '--pathspec-from-file=-', '--pathspec-file-nul'], {
        indexFile: temp,
        input: paths.join('\0'),
        env: { GIT_LITERAL_PATHSPECS: '1' }
      })
    }
  })
}

export async function listTrackedFiles(tree: DeployedTree): Promise<string[]> {
  const raw = await execGit(['ls-tree', '-r', '-z', '--name-only', `refs/heads/${tree.branch}`], {
    cwd: tree.repoPath
  })
  return raw.stdout.toString('utf-8').split('\0').filter(Boolean)
}
