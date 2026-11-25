import { spawn } from 'child_process'
import { existsSync } from 'fs'

export function findGitBinary(): string | undefined {
  if (process.platform === 'darwin') {
    const candidates = ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git']
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
  }
  return undefined
}

export const GIT_BINARY = findGitBinary()

export interface GitExecOptions {
  cwd: string
  env?: Record<string, string>
  input?: Buffer | string
  okCodes?: number[]
  timeoutMs?: number
}

export interface GitExecResult {
  stdout: Buffer
  stderr: string
  code: number
}

export class GitExecError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number,
    readonly stderr: string
  ) {
    super(`git ${subcommandOf(args)} failed (${code}): ${stderr.trim() || 'no output'}`)
    this.name = 'GitExecError'
  }
}

function subcommandOf(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c') {
      i++
      continue
    }
    if (!args[i].startsWith('-')) return args[i]
  }
  return ''
}

export function execGit(args: string[], options: GitExecOptions): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(GIT_BINARY ?? 'git', args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        ...options.env
      },
      windowsHide: true
    })

    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, options.timeoutMs)
      : null

    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const result: GitExecResult = {
        stdout: Buffer.concat(out),
        stderr: timedOut ? 'Connection timed out' : Buffer.concat(err).toString('utf-8'),
        code: code ?? -1
      }
      const ok = options.okCodes ?? [0]
      if (ok.includes(result.code)) resolve(result)
      else reject(new GitExecError(args, result.code, result.stderr))
    })

    child.stdin.on('error', () => {})
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

export async function execGitText(args: string[], options: GitExecOptions): Promise<string> {
  return (await execGit(args, options)).stdout.toString('utf-8')
}

export async function readBlobsBatch(
  repoPath: string,
  rev: string,
  paths: string[]
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>()
  if (paths.length === 0) return result

  const input = paths.map((p) => `${rev}:${p}`).join('\n') + '\n'
  const { stdout } = await execGit(['cat-file', '--batch'], { cwd: repoPath, input })

  let offset = 0
  for (const path of paths) {
    const newline = stdout.indexOf(0x0a, offset)
    if (newline === -1) break
    const header = stdout.subarray(offset, newline).toString('utf-8')
    offset = newline + 1
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) continue
    const size = parseInt(header.split(' ')[2], 10)
    if (Number.isNaN(size)) continue
    result.set(path, Buffer.from(stdout.subarray(offset, offset + size)))
    offset += size + 1
  }
  return result
}

export async function readBlobWithFilters(
  repoPath: string,
  rev: string,
  path: string
): Promise<Buffer> {
  const { stdout } = await execGit(['cat-file', '--filters', `${rev}:${path}`], { cwd: repoPath })
  return stdout
}
