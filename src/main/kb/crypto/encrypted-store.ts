import { createHash } from 'crypto'
import { deriveSubkey, hex, keyedHash, open, pad, seal, unpad, DecryptionError, NONCE_BYTES } from './primitives'
import { keyForEpoch, verifyKeyring, keyringSigners, type Keyring } from './keyring'
import { checkFreshness, decodeManifest, emptyManifest, encodeManifest, RollbackError, type ManifestBody } from './manifest'
import type { RemoteEntry, RemoteStore } from '../sync/remote-store'

export const FORMAT_FILE = 'format.json'
export const KEYRING_FILE = 'keyring.json'
export const MANIFEST_FILE = 'manifest.json'
export const PENDING_DIR = 'pending'
export const OBJECTS_DIR = 'objects'
const MAGIC = Buffer.from('SGKB\x01', 'latin1')

export interface CryptoState {
  lastSeq: number
  lastHash: string | null
  lastEpoch: number
  trusted: string[]
}

export interface EncryptedSession {
  spaceId: string
  keyring: Keyring
  spaceKey: Uint8Array
  signer: { signPk: string; signSk: string }
  state: CryptoState
  onKeyring: (keyring: Keyring) => void
  onCommitted: (state: CryptoState) => void
  reencrypt?: boolean
}

export class KeyringConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyringConflictError'
  }
}

const objectAd = (spaceId: string, id: string, v: number, e: number): string => `sgekb:${spaceId}:object:${id}:${v}:${e}`

export function objectPath(id: string): string {
  return `${OBJECTS_DIR}/${id.slice(0, 2)}/${id}`
}

export async function readFormat(raw: RemoteStore, files: Set<string>): Promise<{ spaceId: string } | null> {
  if (!files.has(FORMAT_FILE)) return null
  const parsed = JSON.parse((await raw.read(FORMAT_FILE)).toString('utf-8')) as { format?: string; spaceId?: string }
  if (parsed.format !== 'sgekb' || typeof parsed.spaceId !== 'string') throw new Error('The remote has an unknown format.json')
  return { spaceId: parsed.spaceId }
}

export class EncryptedStore implements RemoteStore {
  readonly kind: string
  private manifest: ManifestBody
  private manifestHash: string | null = null
  private keyring: Keyring
  private uploadKeyring = false
  private dirty = false

  constructor(
    private readonly raw: RemoteStore,
    private readonly session: EncryptedSession
  ) {
    this.kind = `encrypted-${raw.kind}`
    this.keyring = session.keyring
    this.manifest = emptyManifest(session.spaceId, session.keyring.epoch)
  }

  private async keyFor(epoch: number): Promise<Uint8Array> {
    return keyForEpoch(this.keyring, this.session.spaceKey, epoch)
  }

  async open(): Promise<void> {
    await this.raw.open()
    const files = new Set((await this.raw.list()).map((e) => e.path))
    const format = await readFormat(this.raw, files)
    if (!format) {
      const plaintext = [...files].filter((f) => !f.startsWith(`${PENDING_DIR}/`))
      if (plaintext.length > 0) {
        throw new Error(
          'The destination already holds files that are not encrypted. Use an empty folder or a new repository for an encrypted space.'
        )
      }
      await this.raw.write(
        FORMAT_FILE,
        Buffer.from(JSON.stringify({ format: 'sgekb', version: 1, spaceId: this.session.spaceId, suite: 'xchacha20poly1305/argon2id/x25519+mlkem768/ed25519' }, null, 2))
      )
      this.uploadKeyring = true
      this.dirty = true
      return
    }
    if (format.spaceId !== this.session.spaceId) throw new Error('The destination holds another encrypted space')
    if (files.has(KEYRING_FILE)) {
      const remote = JSON.parse((await this.raw.read(KEYRING_FILE)).toString('utf-8')) as Keyring
      const trusted = this.session.state.trusted.length > 0 ? this.session.state.trusted : keyringSigners(this.keyring)
      const verdict = await verifyKeyring(remote, trusted)
      if (!verdict.ok) throw new DecryptionError(verdict.reason)
      if (remote.epoch < this.session.state.lastEpoch) {
        throw new DecryptionError('The remote keyring is older than the one this device saw: sync stopped.')
      }
      if (remote.rev > this.keyring.rev) {
        if (remote.epoch !== this.keyring.epoch) {
          throw new KeyringConflictError('The space key changed on another device. Unlock the space again to load it.')
        }
        this.keyring = remote
        this.session.onKeyring(remote)
      } else if (remote.rev < this.keyring.rev) {
        this.uploadKeyring = true
        this.dirty = true
      } else if (remote.sig !== this.keyring.sig) {
        throw new KeyringConflictError('Two devices changed the access list at the same time. Review the devices and try again.')
      }
    } else {
      this.uploadKeyring = true
      this.dirty = true
    }
    if (!files.has(MANIFEST_FILE) && this.session.state.lastSeq > 0) {
      throw new RollbackError('The remote lost the manifest of the space this device already synced: sync stopped.')
    }
    if (files.has(MANIFEST_FILE)) {
      const decoded = await decodeManifest(await this.raw.read(MANIFEST_FILE), this.keyring, (e) => this.keyFor(e))
      checkFreshness({ seq: this.session.state.lastSeq, hash: this.session.state.lastHash }, { ...decoded.body, hash: decoded.hash })
      this.manifest = decoded.body
      this.manifestHash = decoded.hash
    }
    if (this.session.reencrypt) await this.reencryptAll()
  }

  async list(): Promise<RemoteEntry[]> {
    return Object.entries(this.manifest.entries).map(([path, e]) => ({ path, size: e.size, mtimeMs: e.v, hash: e.hash }))
  }

  private async pathId(path: string): Promise<string> {
    const nameKey = await deriveSubkey(this.session.spaceKey, 2, 'SGEKBnam')
    return hex(await keyedHash(nameKey, 'path', path.normalize('NFC')))
  }

  async read(path: string): Promise<Buffer> {
    const entry = this.manifest.entries[path]
    if (!entry) throw new Error(`Not in the encrypted space: ${path}`)
    const blob = await this.raw.read(objectPath(entry.id))
    if (blob.length < MAGIC.length + NONCE_BYTES || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new DecryptionError(`Corrupted object for ${path}`)
    }
    const key = await deriveSubkey(await this.keyFor(entry.e), 1, 'SGEKBobj')
    const nonce = blob.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES)
    const ct = blob.subarray(MAGIC.length + NONCE_BYTES)
    const plain = Buffer.from(await unpad(await open(key, nonce, ct, objectAd(this.session.spaceId, entry.id, entry.v, entry.e))))
    if (createHash('sha256').update(plain).digest('hex') !== entry.hash) throw new DecryptionError(`Content mismatch for ${path}`)
    return plain
  }

  async write(path: string, data: Buffer): Promise<RemoteEntry> {
    const previous = this.manifest.entries[path]
    const id = await this.pathId(path)
    const v = (previous?.v ?? 0) + 1
    const e = this.keyring.epoch
    const key = await deriveSubkey(this.session.spaceKey, 1, 'SGEKBobj')
    const sealed = await seal(key, await pad(data), objectAd(this.session.spaceId, id, v, e))
    await this.raw.write(objectPath(id), Buffer.concat([MAGIC, Buffer.from(sealed.nonce), Buffer.from(sealed.ct)]))
    const hash = createHash('sha256').update(data).digest('hex')
    this.manifest.entries[path] = { id, size: data.length, hash, v, e }
    this.dirty = true
    return { path, size: data.length, mtimeMs: v, hash }
  }

  async remove(path: string): Promise<void> {
    const entry = this.manifest.entries[path]
    if (!entry) return
    delete this.manifest.entries[path]
    await this.raw.remove(objectPath(entry.id))
    this.dirty = true
  }

  async reencryptAll(): Promise<number> {
    let n = 0
    for (const path of Object.keys(this.manifest.entries)) {
      if (this.manifest.entries[path].e === this.keyring.epoch) continue
      await this.write(path, await this.read(path))
      n++
    }
    return n
  }

  async commit(): Promise<void> {
    if (!this.dirty) return
    if (this.uploadKeyring) await this.raw.write(KEYRING_FILE, Buffer.from(JSON.stringify(this.keyring, null, 2)))
    const body: ManifestBody = {
      ...this.manifest,
      seq: this.manifest.seq + 1,
      prev: this.manifestHash,
      epoch: this.keyring.epoch,
      at: new Date().toISOString()
    }
    const encoded = await encodeManifest(body, this.session.spaceKey, this.session.signer)
    await this.raw.write(MANIFEST_FILE, encoded.bytes)
    await this.raw.commit({ changed: [], removed: [] })
    this.manifest = body
    this.manifestHash = encoded.hash
    this.uploadKeyring = false
    this.dirty = false
    this.session.onCommitted({
      lastSeq: body.seq,
      lastHash: encoded.hash,
      lastEpoch: this.keyring.epoch,
      trusted: [...new Set([...this.session.state.trusted, ...keyringSigners(this.keyring)])]
    })
  }

  async finish(): Promise<void> {
    if (this.dirty) await this.commit()
  }

  async close(): Promise<void> {
    await this.raw.close()
  }
}
