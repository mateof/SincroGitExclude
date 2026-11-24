import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execGit, GitExecError } from '../../git/git-exec'
import { FsStore } from './fs-store'
import type { RemoteEntry, RemoteStore } from './remote-store'

const AUTHOR = {
  GIT_AUTHOR_NAME: 'sge-kb',
  GIT_AUTHOR_EMAIL: 'sge-kb@localhost',
  GIT_COMMITTER_NAME: 'sge-kb',
  GIT_COMMITTER_EMAIL: 'sge-kb@localhost'
}

export class GitMirrorStore implements RemoteStore {
  readonly kind = 'git'
  private files: FsStore

  constructor(
    private readonly dir: string,
    private readonly remoteUrl: string,
    private readonly branch: string
  ) {
    this.files = new FsStore(dir, 'mirror')
  }

  private git(args: string[], env?: Record<string, string>): Promise<{ stdout: Buffer; stderr: string }> {
    return execGit(args, { cwd: this.dir, env })
  }

  async open(): Promise<void> {
    if (!this.remoteUrl) throw new Error('Set the git remote of the space first')
    if (!existsSync(join(this.dir, '.git'))) {
      mkdirSync(this.dir, { recursive: true })
      await this.git(['init', '-q', '-b', this.branch])
      await this.git(['remote', 'add', 'origin', this.remoteUrl])
    } else {
      await this.git(['remote', 'set-url', 'origin', this.remoteUrl])
    }
    let remoteExists = true
    try {
      await this.git(['fetch', '-q', 'origin', `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`])
    } catch (error) {
      if (error instanceof GitExecError && /couldn't find remote ref|could not find remote ref/i.test(error.stderr)) {
        remoteExists = false
      } else {
        throw error
      }
    }
    if (remoteExists) {
      await this.git(['checkout', '-q', '-B', this.branch, `origin/${this.branch}`])
      await this.git(['reset', '-q', '--hard', `origin/${this.branch}`])
    } else {
      try {
        await this.git(['rev-parse', '--verify', '-q', 'HEAD'])
      } catch {
        await this.git(['checkout', '-q', '--orphan', this.branch]).catch(() => undefined)
      }
    }
    await this.git(['clean', '-q', '-fdx'])
  }

  async list(): Promise<RemoteEntry[]> {
    return (await this.files.list()).filter((e) => !e.path.startsWith('.git/'))
  }

  read(path: string): Promise<Buffer> {
    return this.files.read(path)
  }

  write(path: string, data: Buffer): Promise<RemoteEntry> {
    return this.files.write(path, data)
  }

  remove(path: string): Promise<void> {
    return this.files.remove(path)
  }

  async commit(): Promise<void> {
    await this.git(['add', '-A'])
    const staged = (await this.git(['diff', '--cached', '--name-only'])).stdout.toString('utf-8').trim()
    if (!staged) return
    await this.git(['commit', '-q', '--no-verify', '-m', 'sync'], AUTHOR)
    try {
      await this.git(['push', '-q', 'origin', `HEAD:refs/heads/${this.branch}`])
    } catch (error) {
      const stderr = error instanceof GitExecError ? error.stderr : String(error)
      await this.git(['reset', '-q', '--hard', 'HEAD~1']).catch(() => undefined)
      if (/rejected|non-fast-forward|fetch first/i.test(stderr)) {
        throw new Error('The remote moved while syncing. Sync again to merge the new notes.')
      }
      throw new Error(`push failed: ${stderr.trim()}`)
    }
  }

  async close(): Promise<void> {}
}
