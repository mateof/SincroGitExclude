import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import log from 'electron-log'

function findGitBinary(): string {
  if (process.platform === 'darwin') {
    const candidates = [
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/usr/bin/git'
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
  }
  return 'git'
}

export class GitExcludeService {
  private getExcludePath(repoPath: string): string {
    return join(repoPath, '.git', 'info', 'exclude')
  }

  isGitRepo(repoPath: string): boolean {
    return existsSync(join(repoPath, '.git'))
  }

  async isExcluded(repoPath: string, fileRelativePath: string): Promise<boolean> {
    const excludePath = this.getExcludePath(repoPath)
    if (!existsSync(excludePath)) return false

    const content = readFileSync(excludePath, 'utf-8')
    const normalized = fileRelativePath.replace(/\\/g, '/')
    return content.split('\n').some((line) => {
      const trimmed = line.trim()
      return trimmed === normalized || trimmed === '/' + normalized
    })
  }

  async addExclusion(
    repoPath: string,
    fileRelativePath: string,
    deploymentId?: string
  ): Promise<void> {
    const excludePath = this.getExcludePath(repoPath)
    const normalized = fileRelativePath.replace(/\\/g, '/')

    // Check if already excluded
    if (await this.isExcluded(repoPath, fileRelativePath)) {
      return
    }

    mkdirSync(dirname(excludePath), { recursive: true })

    let content = ''
    if (existsSync(excludePath)) {
      content = readFileSync(excludePath, 'utf-8')
    }

    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n'
    }

    const marker = deploymentId
      ? `# SincroGitExclude [${deploymentId}]`
      : '# SincroGitExclude managed'

    content += `${marker}\n${normalized}\n`
    writeFileSync(excludePath, content, 'utf-8')
    log.info(`Added exclusion for ${normalized} in ${repoPath}`)
  }

  async removeExclusion(
    repoPath: string,
    fileRelativePath: string,
    deploymentId?: string
  ): Promise<void> {
    const excludePath = this.getExcludePath(repoPath)
    if (!existsSync(excludePath)) return

    const content = readFileSync(excludePath, 'utf-8')
    const normalized = fileRelativePath.replace(/\\/g, '/')
    const lines = content.split('\n')
    const filtered: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()

      // Skip our marker comment + the pattern line
      if (
        trimmed.startsWith('# SincroGitExclude') &&
        i + 1 < lines.length &&
        (lines[i + 1].trim() === normalized || lines[i + 1].trim() === '/' + normalized)
      ) {
        i++ // Skip the pattern line too
        continue
      }

      // Skip standalone pattern matches (without marker)
      if (trimmed === normalized || trimmed === '/' + normalized) {
        continue
      }

      filtered.push(lines[i])
    }

    writeFileSync(excludePath, filtered.join('\n'), 'utf-8')
    log.info(`Removed exclusion for ${normalized} from ${repoPath}`)
  }

  async addExclusions(
    repoPath: string,
    filePaths: string[],
    deploymentId: string
  ): Promise<void> {
    for (const fp of filePaths) {
      await this.addExclusion(repoPath, fp, deploymentId)
    }
  }

  async removeExclusions(
    repoPath: string,
    filePaths: string[],
    deploymentId: string
  ): Promise<void> {
    for (const fp of filePaths) {
      await this.removeExclusion(repoPath, fp, deploymentId)
    }
  }

  private getGlobalExcludePath(): string | null {
    // Try git config first (works cross-platform, git expands ~ on all OS)
    try {
      const result = execFileSync(findGitBinary(), ['config', '--global', 'core.excludesFile'], {
        encoding: 'utf-8',
        timeout: 5000
      }).trim()
      if (result) {
        // Expand ~ manually in case git doesn't (some Windows builds)
        const expanded = result.startsWith('~')
          ? join(homedir(), result.slice(1))
          : result
        if (existsSync(expanded)) return expanded
      }
    } catch {
      // Not configured — fall through to defaults
    }

    // XDG default (works on Linux, macOS, and Windows)
    const xdgDefault = join(homedir(), '.config', 'git', 'ignore')
    if (existsSync(xdgDefault)) return xdgDefault

    return null
  }

  async isGloballyExcluded(fileRelativePath: string): Promise<boolean> {
    const globalPath = this.getGlobalExcludePath()
    if (!globalPath) return false

    try {
      const content = readFileSync(globalPath, 'utf-8')
      const normalized = fileRelativePath.replace(/\\/g, '/')
      const fileName = basename(normalized)

      return content.split('\n').some((line) => {
        const trimmed = line.trim()
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) return false
        // Remove leading / or ! (negation not fully supported, just skip)
        if (trimmed.startsWith('!')) return false
        const pattern = trimmed.replace(/^\/+/, '')

        // Exact match against filename or full relative path
        if (pattern === fileName || pattern === normalized) return true

        // Glob pattern matching (e.g. *.env, *.log, .env*)
        const regex = new RegExp(
          '^' +
            pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.') +
            '$'
        )
        return regex.test(fileName) || regex.test(normalized)
      })
    } catch (err) {
      log.warn('Could not read global exclude file:', err)
      return false
    }
  }
}
