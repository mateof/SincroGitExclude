import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { execGit, execGitText } from '../../src/main/git/git-exec'

export interface Fixture {
  root: string
  repo: string
  deployed: string
  globalConfig: string
  cleanup: () => void
}

export function isolateGitConfig(root: string): string {
  const globalConfig = join(root, 'gitconfig-global')
  writeFileSync(globalConfig, '')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  return globalConfig
}

export function writeFile(base: string, rel: string, content: string | Buffer): void {
  const full = join(base, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function readFile(base: string, rel: string): Buffer {
  return readFileSync(join(base, rel))
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execGitText(args, { cwd })).trim()
}

export async function createInternalRepo(
  repo: string,
  files: Record<string, string | Buffer>,
  branch = 'deploy-test'
): Promise<string> {
  mkdirSync(repo, { recursive: true })
  await git(repo, 'init', '-q', '-b', 'master')
  await git(repo, 'config', 'user.name', 'SincroGitExclude')
  await git(repo, 'config', 'user.email', 'sincrogitexclude@local')
  await git(repo, 'config', 'core.fileMode', 'false')
  for (const [rel, content] of Object.entries(files)) writeFile(repo, rel, content)
  await execGit(['add', '-A'], { cwd: repo })
  await git(repo, 'commit', '-q', '-m', 'initial')
  await git(repo, 'branch', branch)
  return git(repo, 'rev-parse', branch)
}

export function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'sge-test-'))
  const globalConfig = isolateGitConfig(root)
  return {
    root,
    repo: join(root, 'internal'),
    deployed: join(root, 'target', 'bundle'),
    globalConfig,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

export function deployFiles(deployed: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) writeFile(deployed, rel, content)
}
