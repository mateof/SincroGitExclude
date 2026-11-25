import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import {
  LOCK_FILE,
  LOCK_TTL_MS,
  RemoteLockedError,
  isStoreInternal,
  lockIsLive,
  type LockBody,
  type RemoteEntry,
  type RemoteStore
} from './remote-store'

export class FsStore implements RemoteStore {
  readonly kind = 'folder'
  private token = randomBytes(12).toString('hex')
  private held = false

  constructor(
    private readonly root: string,
    private readonly holder: string
  ) {}

  private full(rel: string): string {
    if (rel.split('/').some((p) => p === '..' || p === '')) throw new Error(`Invalid remote path: ${rel}`)
    return join(this.root, ...rel.split('/'))
  }

  async open(): Promise<void> {
    try {
      const stat = await fs.stat(this.root)
      if (!stat.isDirectory()) throw new Error(`The destination is not a folder: ${this.root}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`The destination folder is not reachable: ${this.root}. Is the share mounted?`)
      }
      throw error
    }
    const lockPath = join(this.root, LOCK_FILE)
    let current: LockBody | null = null
    try {
      current = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockBody
    } catch {
      current = null
    }
    if (lockIsLive(current, Date.now()) && current!.holder !== this.holder) {
      throw new RemoteLockedError(current!.holder, current!.expiresAt)
    }
    const body: LockBody = {
      holder: this.holder,
      token: this.token,
      expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString()
    }
    await fs.writeFile(lockPath, JSON.stringify(body))
    const check = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockBody
    if (check.token !== this.token) throw new RemoteLockedError(check.holder, check.expiresAt)
    this.held = true
  }

  async list(): Promise<RemoteEntry[]> {
    const out: RemoteEntry[] = []
    const walk = async (rel: string): Promise<void> => {
      const entries = await fs.readdir(rel ? this.full(rel) : this.root, { withFileTypes: true })
      for (const entry of entries) {
        const child = rel ? `${rel}/${entry.name}` : entry.name
        if (isStoreInternal(child)) continue
        if (entry.isDirectory()) await walk(child)
        else if (entry.isFile()) {
          const stat = await fs.stat(this.full(child))
          out.push({ path: child, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) })
        }
      }
    }
    await walk('')
    return out
  }

  read(path: string): Promise<Buffer> {
    return fs.readFile(this.full(path))
  }

  async write(path: string, data: Buffer): Promise<RemoteEntry> {
    const full = this.full(path)
    await fs.mkdir(dirname(full), { recursive: true })
    const tmp = join(dirname(full), `.sge-tmp-${randomBytes(6).toString('hex')}`)
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, full)
    const stat = await fs.stat(full)
    return { path, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) }
  }

  async remove(path: string): Promise<void> {
    const full = this.full(path)
    await fs.rm(full, { force: true })
    let dir = dirname(full)
    while (dir.startsWith(this.root) && dir !== this.root) {
      try {
        await fs.rmdir(dir)
      } catch {
        break
      }
      dir = dirname(dir)
    }
  }

  async commit(): Promise<void> {}

  async close(): Promise<void> {
    if (!this.held) return
    this.held = false
    const lockPath = join(this.root, LOCK_FILE)
    try {
      const current = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockBody
      if (current.token === this.token) await fs.rm(lockPath, { force: true })
    } catch {
      return
    }
  }
}
