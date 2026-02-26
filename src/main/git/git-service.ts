import simpleGit, { SimpleGit, LogResult } from 'simple-git'
import log from 'electron-log'

export interface CommitLogEntry {
  hash: string
  message: string
  date: string
  tag?: string
}

export class GitService {
  private locks: Map<string, Promise<void>> = new Map()

  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  async withLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(repoPath) || Promise.resolve()
    let release: () => void
    const newLock = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(repoPath, newLock)

    await existing
    try {
      return await fn()
    } finally {
      release!()
    }
  }

  async initRepo(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.init()
    await git.addConfig('user.name', 'SincroGitExclude')
    await git.addConfig('user.email', 'sincrogitexclude@local')
    // Enable long paths on Windows
    await git.addConfig('core.longpaths', 'true')
    log.info(`Initialized git repo at ${repoPath}`)
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    startPoint?: string
  ): Promise<void> {
    const git = this.getGit(repoPath)
    if (startPoint) {
      await git.checkoutBranch(branchName, startPoint)
    } else {
      const current = (await git.branchLocal()).current
      await git.checkoutBranch(branchName, current)
    }
  }

  async checkout(repoPath: string, branchOrCommit: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.checkout(branchOrCommit)
  }

  async addAndCommit(
    repoPath: string,
    filePath: string,
    message: string
  ): Promise<string> {
    const git = this.getGit(repoPath)
    await git.add(filePath)
    const status = await git.status()
    if (status.staged.length === 0) {
      throw new Error('No changes to commit')
    }
    const result = await git.commit(message)
    return result.commit
  }

  async addTag(repoPath: string, tagName: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.tag([tagName])
  }

  async getLog(repoPath: string, branch?: string): Promise<CommitLogEntry[]> {
    const git = this.getGit(repoPath)
    const args: string[] = []
    if (branch) {
      args.push(branch)
    }

    try {
      const logResult: LogResult = await git.log(args.length > 0 ? args : undefined)

      // Get tags to match with commits
      const tagsRaw = await git.tags()
      const tagMap = new Map<string, string>()

      for (const tagName of tagsRaw.all) {
        try {
          const tagHash = await git.revparse([tagName])
          tagMap.set(tagHash.trim(), tagName)
        } catch {
          // ignore
        }
      }

      return logResult.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        date: entry.date,
        tag: tagMap.get(entry.hash)
      }))
    } catch {
      return []
    }
  }

  async getDiff(
    repoPath: string,
    hash1: string,
    hash2?: string,
    filterContent: boolean = true
  ): Promise<string> {
    const git = this.getGit(repoPath)
    const contentFilter = filterContent ? ['--', 'content'] : []
    if (hash2) {
      return git.diff([hash1, hash2, ...contentFilter])
    } else {
      try {
        return await git.diff([`${hash1}~1`, hash1, ...contentFilter])
      } catch {
        if (filterContent) {
          // First commit has no parent
          return git.diff([
            '--no-index',
            '/dev/null',
            `${hash1}:content`
          ]).catch(() => '')
        }
        return ''
      }
    }
  }

  async getDiffWorkingTree(repoPath: string, filterContent: boolean = true): Promise<string> {
    const git = this.getGit(repoPath)
    const args = filterContent ? ['HEAD', '--', 'content'] : ['HEAD']
    return git.diff(args)
  }

  async addAllAndCommit(repoPath: string, message: string): Promise<string> {
    const git = this.getGit(repoPath)
    await git.add('.')
    const status = await git.status()
    if (status.staged.length === 0) {
      throw new Error('No changes to commit')
    }
    const result = await git.commit(message)
    return result.commit
  }

  async listFiles(repoPath: string): Promise<string[]> {
    const git = this.getGit(repoPath)
    const result = await git.raw(['ls-files'])
    return result.trim().split('\n').filter(Boolean)
  }

  async listFilesAtCommit(repoPath: string, hash: string): Promise<string[]> {
    const git = this.getGit(repoPath)
    const result = await git.raw(['ls-tree', '-r', '--name-only', hash])
    return result.trim().split('\n').filter(Boolean)
  }

  async getFileAtCommit(
    repoPath: string,
    commitHash: string,
    filePath: string = 'content'
  ): Promise<string> {
    const git = this.getGit(repoPath)
    return git.show([`${commitHash}:${filePath}`])
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const git = this.getGit(repoPath)
    const branches = await git.branchLocal()
    return branches.all
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const git = this.getGit(repoPath)
    const branches = await git.branchLocal()
    return branches.current
  }

  async hasChanges(repoPath: string): Promise<boolean> {
    const git = this.getGit(repoPath)
    const status = await git.status()
    return status.modified.length > 0 || status.not_added.length > 0
  }

  async stageAndCheck(repoPath: string, filePath: string): Promise<boolean> {
    const git = this.getGit(repoPath)
    await git.add(filePath)
    const status = await git.status()
    if (status.staged.length === 0) {
      return false
    }
    // Unstage since we're just checking
    await git.reset(['HEAD', '--', filePath])
    return true
  }

  async restoreWorkingTree(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.checkout(['.'])
  }
}
