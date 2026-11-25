export interface RemoteEntry {
  path: string
  size: number
  mtimeMs: number
  hash?: string
}

export interface RemoteStore {
  readonly kind: string
  open(): Promise<void>
  list(): Promise<RemoteEntry[]>
  read(path: string): Promise<Buffer>
  write(path: string, data: Buffer): Promise<RemoteEntry>
  remove(path: string): Promise<void>
  commit(summary: { changed: string[]; removed: string[] }): Promise<void>
  close(): Promise<void>
}

export class RemoteLockedError extends Error {
  constructor(readonly holder: string, readonly expiresAt: string) {
    super(`Another machine (${holder}) is syncing this space. Try again after ${expiresAt}.`)
    this.name = 'RemoteLockedError'
  }
}

export const LOCK_FILE = '.sge-kb-lock'
export const LOCK_TTL_MS = 2 * 60 * 1000

export interface LockBody {
  holder: string
  token: string
  expiresAt: string
}

export function lockIsLive(body: LockBody | null, now: number): boolean {
  return body !== null && Date.parse(body.expiresAt) > now
}

export function isStoreInternal(path: string): boolean {
  return path === LOCK_FILE || path.endsWith('.sge-tmp') || path.split('/').some((p) => p.startsWith('.sge-tmp-'))
}
