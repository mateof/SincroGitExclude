import SftpClient from 'ssh2-sftp-client'
import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { posix } from 'path'
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
import type { SftpBackendConfig } from '../../../shared/kb/types'

export class HostKeyError extends Error {
  constructor(
    message: string,
    readonly fingerprint: string
  ) {
    super(message)
    this.name = 'HostKeyError'
  }
}

export function formatFingerprint(hex: string): string {
  return `SHA256:${Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '')}`
}

export function checkHostKey(expected: string | undefined, presentedHex: string): { ok: boolean; fingerprint: string } {
  const fingerprint = formatFingerprint(presentedHex)
  return { ok: expected !== undefined && expected === fingerprint, fingerprint }
}

function agentSocket(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK
  if (process.platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent'
  return undefined
}

export function connectOptions(
  config: SftpBackendConfig,
  passphrase: string | undefined,
  onHostKey: (hex: string) => boolean
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    readyTimeout: 15000,
    hostHash: 'sha256',
    hostVerifier: (hash: string) => onHostKey(hash)
  }
  if (config.auth === 'key') {
    if (!config.privateKeyPath) throw new Error('Choose the private key file for SFTP')
    base.privateKey = readFileSync(config.privateKeyPath)
    if (passphrase) base.passphrase = passphrase
  } else {
    const agent = agentSocket()
    if (!agent) throw new Error('No SSH agent found. Start ssh-agent or use a key file.')
    base.agent = agent
  }
  return base
}

export async function probeSftp(
  config: SftpBackendConfig,
  passphrase?: string
): Promise<{ fingerprint: string; trusted: boolean; pathExists: boolean }> {
  const client = new SftpClient()
  let seen = ''
  try {
    await client.connect(
      connectOptions(config, passphrase, (hex) => {
        seen = hex
        return true
      }) as never
    )
    const exists = await client.exists(config.remotePath)
    const fingerprint = formatFingerprint(seen)
    return { fingerprint, trusted: config.hostFingerprint === fingerprint, pathExists: exists === 'd' }
  } finally {
    await client.end().catch(() => {})
  }
}

export class SftpStore implements RemoteStore {
  readonly kind = 'sftp'
  private client = new SftpClient()
  private token = randomBytes(12).toString('hex')
  private held = false
  private connected = false

  constructor(
    private readonly config: SftpBackendConfig,
    private readonly holder: string,
    private readonly passphrase?: string
  ) {}

  private full(rel: string): string {
    if (rel.split('/').some((p) => p === '..' || p === '')) throw new Error(`Invalid remote path: ${rel}`)
    return posix.join(this.config.remotePath, rel)
  }

  async open(): Promise<void> {
    if (!this.config.hostFingerprint) {
      throw new Error('Confirm the server fingerprint first: use "Test connection" in the space settings.')
    }
    let presented = ''
    await this.client.connect(
      connectOptions(this.config, this.passphrase, (hex) => {
        presented = hex
        return checkHostKey(this.config.hostFingerprint, hex).ok
      }) as never
    ).catch((error: Error) => {
      if (presented && !checkHostKey(this.config.hostFingerprint, presented).ok) {
        throw new HostKeyError(
          `The server key changed (now ${formatFingerprint(presented)}). If you did not change the server, someone may be intercepting the connection.`,
          formatFingerprint(presented)
        )
      }
      throw error
    })
    this.connected = true
    if ((await this.client.exists(this.config.remotePath)) !== 'd') {
      await this.client.mkdir(this.config.remotePath, true)
    }
    const lockPath = this.full(LOCK_FILE)
    let current: LockBody | null = null
    try {
      current = JSON.parse(((await this.client.get(lockPath)) as Buffer).toString('utf-8')) as LockBody
    } catch {
      current = null
    }
    if (lockIsLive(current, Date.now()) && current!.holder !== this.holder) {
      throw new RemoteLockedError(current!.holder, current!.expiresAt)
    }
    const body: LockBody = { holder: this.holder, token: this.token, expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString() }
    await this.client.put(Buffer.from(JSON.stringify(body)), lockPath)
    const check = JSON.parse(((await this.client.get(lockPath)) as Buffer).toString('utf-8')) as LockBody
    if (check.token !== this.token) throw new RemoteLockedError(check.holder, check.expiresAt)
    this.held = true
  }

  async list(): Promise<RemoteEntry[]> {
    const out: RemoteEntry[] = []
    const walk = async (rel: string): Promise<void> => {
      const entries = await this.client.list(rel ? this.full(rel) : this.config.remotePath)
      for (const entry of entries) {
        const child = rel ? `${rel}/${entry.name}` : entry.name
        if (isStoreInternal(child)) continue
        if (entry.type === 'd') await walk(child)
        else if (entry.type === '-') out.push({ path: child, size: entry.size, mtimeMs: entry.modifyTime })
      }
    }
    await walk('')
    return out
  }

  async read(path: string): Promise<Buffer> {
    return (await this.client.get(this.full(path))) as Buffer
  }

  async write(path: string, data: Buffer): Promise<RemoteEntry> {
    const full = this.full(path)
    const dir = posix.dirname(full)
    if ((await this.client.exists(dir)) !== 'd') await this.client.mkdir(dir, true)
    const tmp = posix.join(dir, `.sge-tmp-${randomBytes(6).toString('hex')}`)
    await this.client.put(data, tmp)
    try {
      await this.client.posixRename(tmp, full)
    } catch {
      if (await this.client.exists(full)) await this.client.delete(full)
      await this.client.rename(tmp, full)
    }
    const stat = await this.client.stat(full)
    return { path, size: stat.size, mtimeMs: stat.modifyTime }
  }

  async remove(path: string): Promise<void> {
    const full = this.full(path)
    if (await this.client.exists(full)) await this.client.delete(full)
  }

  async commit(): Promise<void> {}

  async close(): Promise<void> {
    try {
      if (this.held) {
        const lockPath = this.full(LOCK_FILE)
        const current = JSON.parse(((await this.client.get(lockPath)) as Buffer).toString('utf-8')) as LockBody
        if (current.token === this.token) await this.client.delete(lockPath)
      }
    } catch {
      this.held = false
    } finally {
      this.held = false
      if (this.connected) await this.client.end().catch(() => {})
      this.connected = false
    }
  }
}
