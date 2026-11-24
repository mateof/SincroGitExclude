import { execFile } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { execGit, GitExecError } from '../../git/git-exec'
import { canSendToken, parseRemote, type RemoteInfo } from '../../../shared/kb/git-remote'

const run = promisify(execFile)

export interface GitAuth {
  args: string[]
  env: Record<string, string>
}

export interface GitCredential {
  username: string
  token: string
}

export type GitProblem = 'auth' | 'not-found' | 'network' | 'other'

export interface RemoteProbe {
  ok: boolean
  problem: GitProblem | null
  message: string | null
  branches: string[]
  defaultBranch: string | null
  empty: boolean
  publicRead: boolean | null
}

const NO_HELPERS = ['-c', 'credential.helper=', '-c', 'core.askPass=']
const NO_PROMPTS = { GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_TERMINAL_PROMPT: '0' }
const HELPER = `!f() { test "$1" = get || exit 0; printf 'username=%s\\npassword=%s\\n' "$SGE_GIT_USERNAME" "$SGE_GIT_PASSWORD"; }; f`
const PROBE_TIMEOUT_MS = 20_000

export function tokenAuth(info: RemoteInfo, credential: GitCredential): GitAuth {
  if (!info.origin) throw new Error('A token only works with an http or https remote')
  if (!canSendToken(info)) throw new Error('The token would travel unencrypted over the internet. Use an https remote.')
  if (/[\r\n\0]/.test(credential.username + credential.token) || !credential.token) throw new Error('The token is not valid')
  return {
    args: [...NO_HELPERS, '-c', `credential.${info.origin}.helper=${HELPER}`],
    env: { ...NO_PROMPTS, SGE_GIT_USERNAME: credential.username, SGE_GIT_PASSWORD: credential.token }
  }
}

export function sshKeyAuth(keyPath: string): GitAuth {
  const full = keyPath.startsWith('~/') ? join(homedir(), keyPath.slice(2)) : keyPath
  if (!existsSync(full)) throw new Error(`The SSH key does not exist: ${keyPath}`)
  return {
    args: [],
    env: { GIT_SSH_COMMAND: `ssh -i '${full.replace(/'/g, `'\\''`)}' -o IdentitiesOnly=yes -o BatchMode=yes` }
  }
}

export async function ghToken(host: string, username: string | undefined): Promise<string> {
  const binary = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'].find((p) => existsSync(p)) ?? 'gh'
  const env = { ...process.env }
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[key]
  const args = ['auth', 'token', '--hostname', host, ...(username ? ['--user', username] : [])]
  try {
    const { stdout } = await run(binary, args, { env, timeout: 15_000 })
    const token = stdout.trim()
    if (token) return token
  } catch {
    throw new Error(`GitHub CLI has no session${username ? ` for ${username}` : ''} on ${host}. Run gh auth login.`)
  }
  throw new Error('GitHub CLI returned no token')
}

export function classifyGitError(stderr: string): GitProblem {
  if (/could not read (Username|Password)|Authentication failed|HTTP Basic|Permission denied|access denied|returned error: 40[13]|Invalid username or (password|token)/i.test(stderr)) return 'auth'
  if (/not found|does not exist|does not appear to be a git repository|returned error: 404/i.test(stderr)) return 'not-found'
  if (/could not resolve|connection refused|timed out|unreachable|couldn't connect|failed to connect|ssl|certificate|host key/i.test(stderr)) return 'network'
  return 'other'
}

export function explainGitError(stderr: string): string {
  const detail = stderr.trim().split('\n').slice(0, 3).join(' ')
  const problem = classifyGitError(stderr)
  if (problem === 'auth') return `The server did not accept the credentials of this space. Check the authentication in its settings. (${detail})`
  if (problem === 'not-found') return `The repository does not exist or these credentials cannot see it. (${detail})`
  if (problem === 'network') return `Could not reach the server. (${detail})`
  return detail
}

async function listRemote(url: string, auth: GitAuth | undefined, cwd: string): Promise<string> {
  const result = await execGit([...(auth?.args ?? []), 'ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*'], {
    cwd,
    env: auth?.env,
    timeoutMs: PROBE_TIMEOUT_MS
  })
  return result.stdout.toString('utf-8')
}

async function isPublic(url: string, cwd: string): Promise<boolean | null> {
  const env: Record<string, string> = { ...NO_PROMPTS, HOME: cwd, USERPROFILE: cwd, NETRC: join(cwd, 'none') }
  const globalConfig = process.env.GIT_CONFIG_GLOBAL ?? join(homedir(), '.gitconfig')
  if (existsSync(globalConfig)) env.GIT_CONFIG_GLOBAL = globalConfig
  try {
    await listRemote(url, { args: NO_HELPERS, env }, cwd)
    return true
  } catch (error) {
    const problem = error instanceof GitExecError ? classifyGitError(error.stderr) : 'other'
    return problem === 'auth' || problem === 'not-found' ? false : null
  }
}

export async function probeRemote(url: string, auth: GitAuth | undefined): Promise<RemoteProbe> {
  const info = parseRemote(url)
  const cwd = mkdtempSync(join(tmpdir(), 'sge-probe-'))
  const base = { branches: [], defaultBranch: null, empty: false }
  try {
    const publicRead = info.kind === 'http' ? await isPublic(url, cwd) : null
    try {
      const lines = (await listRemote(url, auth, cwd)).split('\n').filter(Boolean)
      const branches = lines.filter((l) => l.includes('\trefs/heads/') && !l.startsWith('ref:')).map((l) => l.split('\trefs/heads/')[1])
      const head = lines.find((l) => l.startsWith('ref: refs/heads/'))
      return {
        ok: true,
        problem: null,
        message: null,
        branches,
        defaultBranch: head ? head.slice('ref: refs/heads/'.length).split('\t')[0] : null,
        empty: branches.length === 0,
        publicRead
      }
    } catch (error) {
      const stderr = error instanceof GitExecError ? error.stderr : (error as Error).message
      return { ...base, ok: false, problem: classifyGitError(stderr), message: explainGitError(stderr), publicRead }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}
