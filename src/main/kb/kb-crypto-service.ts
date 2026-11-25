import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes as nodeRandomBytes, randomInt } from 'crypto'
import { wordlist as english } from '@scure/bip39/wordlists/english.js'
import { wordlist as spanish } from '@scure/bip39/wordlists/spanish.js'
import { getDb } from '../database/connection'
import { APP_DATA_DIR } from '../app-paths'
import type { KbService } from './kb-service'
import { getSecret, osKeychainUsable, setSecret } from './secret-vault'
import type { GitAuth } from './sync/git-auth'
import { createIdentity, fingerprint, isPublicIdentity, pairingCode, publicPart, type PrivateIdentity, type PublicIdentity } from './crypto/identity'
import {
  addRecipient,
  canWrite,
  changePassphrase,
  createKeyring,
  keyringSigners,
  removeRecipientAndRotate,
  resetRecovery,
  unlockWithDevice,
  unlockWithPassphrase,
  unlockWithRecovery,
  verifyKeyring,
  type Keyring,
  type OwnerSecrets,
  type RecipientKind,
  type RecipientRole
} from './crypto/keyring'
import { EncryptedStore, FORMAT_FILE, KEYRING_FILE, PENDING_DIR, type CryptoState } from './crypto/encrypted-store'
import { wipe } from './crypto/primitives'
import { GitMirrorStore } from './sync/git-mirror-store'
import type { RemoteStore } from './sync/remote-store'
import type { KbCryptoStatus } from '../../shared/kb/types'

interface Unlocked {
  keyring: Keyring
  spaceKey: Uint8Array
  owner: OwnerSecrets | null
}

interface PendingEnable {
  keyring: Keyring
  secrets: OwnerSecrets
  words: string[]
  asked: number[]
  expires: number
}

interface StateRow {
  space_id: string
  crypto_space_id: string
  device_id: string | null
  last_seq: number
  last_manifest_hash: string | null
  last_epoch: number
  trusted_signers: string
}

const DEVICE_KEY = 'kb-device-identity'

export function passphraseProblem(passphrase: string): string | null {
  const p = passphrase.normalize('NFKC')
  if (p.length < 14) return 'Use at least 14 characters (a phrase of several words is easier to remember).'
  if (new Set(p.toLowerCase()).size < 8) return 'The passphrase repeats too few characters.'
  const words = p.split(/[\s\-_.]+/).filter(Boolean)
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9\s]/].filter((r) => r.test(p)).length
  if (words.length < 4 && classes < 3 && p.length < 20) {
    return 'Use four or more words, or mix letters, digits and symbols.'
  }
  return null
}

export function generatePassphrase(language: 'es' | 'en' = 'es', count = 7): string {
  const list = language === 'es' ? spanish : english
  return Array.from({ length: count }, () => list[randomInt(list.length)].normalize('NFD').replace(/\p{M}/gu, '')).join('-')
}

export interface CryptoDeps {
  rawStoreFor: (spaceId: string) => Promise<RemoteStore>
  triggerSync: (spaceId: string) => void
  machineName: () => string
}

export class KbCryptoService {
  private unlocked = new Map<string, Unlocked>()
  private pendingEnable = new Map<string, PendingEnable>()
  private sessionDevice: PrivateIdentity | null = null

  constructor(
    private readonly kb: KbService,
    private readonly deps: CryptoDeps
  ) {}

  private async device(): Promise<PrivateIdentity> {
    if (this.sessionDevice) return this.sessionDevice
    const stored = getSecret(DEVICE_KEY)
    if (stored) {
      this.sessionDevice = JSON.parse(stored.toString('utf-8')) as PrivateIdentity
      return this.sessionDevice
    }
    const created = await createIdentity(this.deps.machineName())
    if (osKeychainUsable()) setSecret(DEVICE_KEY, Buffer.from(JSON.stringify(created)))
    this.sessionDevice = created
    return created
  }

  private keyringPath(spaceId: string): string {
    return join(APP_DATA_DIR, 'kb-crypto', spaceId, 'keyring.json')
  }

  private readLocalKeyring(spaceId: string): Keyring | null {
    const file = this.keyringPath(spaceId)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8')) as Keyring
  }

  private writeLocalKeyring(spaceId: string, keyring: Keyring): void {
    const file = this.keyringPath(spaceId)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(keyring, null, 2), 'utf-8')
  }

  private state(spaceId: string): (CryptoState & { cryptoSpaceId: string }) | null {
    const row = getDb().prepare('SELECT * FROM kb_crypto_state WHERE space_id = ?').get(spaceId) as StateRow | undefined
    if (!row) return null
    return {
      cryptoSpaceId: row.crypto_space_id,
      lastSeq: row.last_seq,
      lastHash: row.last_manifest_hash,
      lastEpoch: row.last_epoch,
      trusted: JSON.parse(row.trusted_signers || '[]') as string[]
    }
  }

  private saveState(spaceId: string, state: CryptoState & { cryptoSpaceId: string }): void {
    getDb()
      .prepare(
        `INSERT INTO kb_crypto_state (space_id, crypto_space_id, device_id, last_seq, last_manifest_hash, last_epoch, trusted_signers)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id) DO UPDATE SET crypto_space_id = excluded.crypto_space_id, device_id = excluded.device_id,
           last_seq = excluded.last_seq, last_manifest_hash = excluded.last_manifest_hash,
           last_epoch = excluded.last_epoch, trusted_signers = excluded.trusted_signers`
      )
      .run(
        spaceId,
        state.cryptoSpaceId,
        this.sessionDevice?.id ?? null,
        state.lastSeq,
        state.lastHash,
        state.lastEpoch,
        JSON.stringify([...new Set(state.trusted)])
      )
  }

  private async fetchRemote(spaceId: string): Promise<{ keyring: Keyring | null; cryptoSpaceId: string | null; pending: PublicIdentity[] }> {
    const raw = await this.deps.rawStoreFor(spaceId)
    await raw.open()
    try {
      const files = new Set((await raw.list()).map((e) => e.path))
      let cryptoSpaceId: string | null = null
      if (files.has(FORMAT_FILE)) {
        const format = JSON.parse((await raw.read(FORMAT_FILE)).toString('utf-8')) as { spaceId?: string }
        cryptoSpaceId = typeof format.spaceId === 'string' ? format.spaceId : null
      }
      const keyring = files.has(KEYRING_FILE) ? (JSON.parse((await raw.read(KEYRING_FILE)).toString('utf-8')) as Keyring) : null
      const pending: PublicIdentity[] = []
      for (const path of files) {
        if (!path.startsWith(`${PENDING_DIR}/`) || !path.endsWith('.json')) continue
        try {
          const parsed = JSON.parse((await raw.read(path)).toString('utf-8')) as { identity?: unknown }
          if (isPublicIdentity(parsed.identity)) pending.push(parsed.identity)
        } catch {
          continue
        }
      }
      return { keyring, cryptoSpaceId, pending }
    } finally {
      await raw.close()
    }
  }

  private async currentKeyring(spaceId: string): Promise<Keyring> {
    const local = this.readLocalKeyring(spaceId)
    if (local) return local
    const remote = await this.fetchRemote(spaceId)
    if (!remote.keyring) throw new Error('The remote has no encrypted space yet')
    this.writeLocalKeyring(spaceId, remote.keyring)
    return remote.keyring
  }

  private requireOwner(spaceId: string): { unlocked: Unlocked; owner: OwnerSecrets } {
    const unlocked = this.unlocked.get(spaceId)
    if (!unlocked) throw new Error('Unlock the space first')
    if (!unlocked.owner) throw new Error('Only the owner can do this. Unlock with the passphrase on one of the owner devices.')
    return { unlocked, owner: unlocked.owner }
  }

  private setUnlocked(spaceId: string, keyring: Keyring, spaceKey: Uint8Array, owner: OwnerSecrets | null): void {
    this.unlocked.set(spaceId, { keyring, spaceKey, owner })
  }

  isEncrypted(spaceId: string): boolean {
    return this.kb.getSpace(spaceId).encrypted
  }

  isUnlockedNow(spaceId: string): boolean {
    return this.unlocked.has(spaceId)
  }

  async ensureUnlocked(spaceId: string): Promise<boolean> {
    if (this.unlocked.has(spaceId)) return true
    const state = this.state(spaceId)
    if (!state || state.trusted.length === 0) return false
    let keyring: Keyring
    try {
      keyring = await this.currentKeyring(spaceId)
    } catch {
      return false
    }
    const device = await this.device()
    if (!keyring.recipients.some((r) => r.id === device.id && r.signPk === device.signPk)) return false
    const verdict = await verifyKeyring(keyring, state.trusted)
    if (!verdict.ok) return false
    const access = await unlockWithDevice(keyring, device)
    this.setUnlocked(spaceId, keyring, access.spaceKey, access.owner)
    return true
  }

  canPublish(spaceId: string): boolean {
    const unlocked = this.unlocked.get(spaceId)
    if (!unlocked) return false
    if (unlocked.owner) return true
    const device = this.sessionDevice
    return !!device && canWrite(unlocked.keyring, device.signPk)
  }

  async prepareEnable(spaceId: string, passphrase: string, rememberDevice: boolean): Promise<{ words: string[]; asked: number[] }> {
    const space = this.kb.getSpace(spaceId)
    if (space.encrypted) throw new Error('The space is already encrypted')
    if (space.backend === 'none') throw new Error('Choose where the space is stored (git, folder or SFTP) before encrypting it')
    const problem = passphraseProblem(passphrase)
    if (problem) throw new Error(problem)
    const device = rememberDevice && osKeychainUsable() ? await this.device() : null
    const { keyring, secrets, recoveryWords } = await createKeyring(spaceId, passphrase, { device })
    const asked: number[] = []
    while (asked.length < 3) {
      const i = randomInt(24)
      if (!asked.includes(i)) asked.push(i)
    }
    asked.sort((a, b) => a - b)
    this.pendingEnable.set(spaceId, { keyring, secrets, words: recoveryWords, asked, expires: Date.now() + 30 * 60_000 })
    return { words: recoveryWords, asked }
  }

  async confirmEnable(spaceId: string, answers: Record<number, string>): Promise<KbCryptoStatus> {
    const pending = this.pendingEnable.get(spaceId)
    if (!pending || pending.expires < Date.now()) throw new Error('Start again: the recovery code expired')
    for (const i of pending.asked) {
      if ((answers[i] ?? '').trim().toLowerCase() !== pending.words[i]) {
        throw new Error(`Word ${i + 1} does not match. Check the recovery code you wrote down.`)
      }
    }
    this.pendingEnable.delete(spaceId)
    this.writeLocalKeyring(spaceId, pending.keyring)
    this.saveState(spaceId, {
      cryptoSpaceId: spaceId,
      lastSeq: 0,
      lastHash: null,
      lastEpoch: pending.keyring.epoch,
      trusted: keyringSigners(pending.keyring)
    })
    this.kb.setEncryptedFlag(spaceId, true)
    getDb().prepare('DELETE FROM kb_sync_state WHERE space_id = ?').run(spaceId)
    this.setUnlocked(spaceId, pending.keyring, pending.secrets.spaceKey, pending.secrets)
    this.deps.triggerSync(spaceId)
    return this.status(spaceId)
  }

  async adoptExisting(spaceId: string): Promise<KbCryptoStatus> {
    const remote = await this.fetchRemote(spaceId)
    if (!remote.cryptoSpaceId || !remote.keyring) throw new Error('The destination is not an encrypted space')
    this.writeLocalKeyring(spaceId, remote.keyring)
    this.saveState(spaceId, { cryptoSpaceId: remote.cryptoSpaceId, lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] })
    this.kb.setEncryptedFlag(spaceId, true)
    getDb().prepare('DELETE FROM kb_sync_state WHERE space_id = ?').run(spaceId)
    return this.status(spaceId)
  }

  private async unlockWithOwner(spaceId: string, open: (keyring: Keyring) => Promise<OwnerSecrets>): Promise<KbCryptoStatus> {
    const remote = await this.fetchRemote(spaceId).catch(() => null)
    const local = this.readLocalKeyring(spaceId)
    const candidates = [remote?.keyring, local].filter((k): k is Keyring => !!k).sort((a, b) => b.rev - a.rev)
    if (candidates.length === 0) throw new Error('No keyring found for this space')
    let lastError: unknown = null
    for (const keyring of candidates) {
      try {
        const owner = await open(keyring)
        const verdict = await verifyKeyring(keyring, [owner.ownerIdentity.signPk, ...keyringSigners(keyring)])
        if (!verdict.ok || !keyringSigners(keyring).includes(keyring.signer)) throw new Error(verdict.reason ?? 'Invalid keyring')
        this.writeLocalKeyring(spaceId, keyring)
        const state = this.state(spaceId)
        this.saveState(spaceId, {
          cryptoSpaceId: state?.cryptoSpaceId ?? remote?.cryptoSpaceId ?? spaceId,
          lastSeq: state?.lastSeq ?? 0,
          lastHash: state?.lastHash ?? null,
          lastEpoch: Math.max(state?.lastEpoch ?? 0, keyring.epoch),
          trusted: [...(state?.trusted ?? []), ...keyringSigners(keyring)]
        })
        this.setUnlocked(spaceId, keyring, owner.spaceKey, owner)
        this.deps.triggerSync(spaceId)
        return this.status(spaceId)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  unlockPassphrase(spaceId: string, passphrase: string): Promise<KbCryptoStatus> {
    return this.unlockWithOwner(spaceId, (k) => unlockWithPassphrase(k, passphrase))
  }

  unlockRecovery(spaceId: string, words: string): Promise<KbCryptoStatus> {
    return this.unlockWithOwner(spaceId, (k) => unlockWithRecovery(k, words))
  }

  async lock(spaceId: string): Promise<KbCryptoStatus> {
    const unlocked = this.unlocked.get(spaceId)
    if (unlocked) {
      await wipe(unlocked.spaceKey, unlocked.owner?.ownerKey, unlocked.owner?.spaceKey)
      this.unlocked.delete(spaceId)
    }
    return this.status(spaceId)
  }

  private async saveKeyringChange(spaceId: string, keyring: Keyring, spaceKey?: Uint8Array): Promise<void> {
    const unlocked = this.unlocked.get(spaceId)!
    this.writeLocalKeyring(spaceId, keyring)
    const owner = unlocked.owner && spaceKey ? { ...unlocked.owner, spaceKey } : unlocked.owner
    this.setUnlocked(spaceId, keyring, spaceKey ?? unlocked.spaceKey, owner)
    const state = this.state(spaceId)
    if (state) this.saveState(spaceId, { ...state, lastEpoch: keyring.epoch, trusted: [...state.trusted, ...keyringSigners(keyring)] })
    this.deps.triggerSync(spaceId)
  }

  async rememberDevice(spaceId: string): Promise<KbCryptoStatus> {
    if (!osKeychainUsable()) throw new Error('This system has no usable keychain: the passphrase will be asked on every start.')
    const { unlocked, owner } = this.requireOwner(spaceId)
    const device = await this.device()
    const keyring = await addRecipient(unlocked.keyring, owner, publicPart(device), 'device', 'admin')
    await this.saveKeyringChange(spaceId, keyring)
    return this.status(spaceId)
  }

  async removeRecipient(spaceId: string, recipientId: string): Promise<KbCryptoStatus> {
    const { unlocked, owner } = this.requireOwner(spaceId)
    const rotated = await removeRecipientAndRotate(unlocked.keyring, owner, recipientId)
    await this.saveKeyringChange(spaceId, rotated.keyring, rotated.spaceKey)
    return this.status(spaceId)
  }

  async changePassphrase(spaceId: string, passphrase: string): Promise<KbCryptoStatus> {
    const problem = passphraseProblem(passphrase)
    if (problem) throw new Error(problem)
    const { unlocked, owner } = this.requireOwner(spaceId)
    await this.saveKeyringChange(spaceId, await changePassphrase(unlocked.keyring, owner, passphrase))
    return this.status(spaceId)
  }

  async resetRecovery(spaceId: string): Promise<{ words: string[] }> {
    const { unlocked, owner } = this.requireOwner(spaceId)
    const result = await resetRecovery(unlocked.keyring, owner)
    await this.saveKeyringChange(spaceId, result.keyring)
    return { words: result.words }
  }

  async requestAccess(spaceId: string): Promise<{ fingerprint: string; deviceName: string }> {
    const device = await this.device()
    const raw = await this.deps.rawStoreFor(spaceId)
    await raw.open()
    try {
      await raw.write(
        `${PENDING_DIR}/${device.id}.json`,
        Buffer.from(JSON.stringify({ identity: publicPart(device), requestedAt: new Date().toISOString(), nonce: nodeRandomBytes(8).toString('hex') }))
      )
      await raw.commit({ changed: [], removed: [] })
    } finally {
      await raw.close()
    }
    return { fingerprint: await fingerprint(publicPart(device)), deviceName: device.name }
  }

  async listPending(spaceId: string): Promise<Array<{ id: string; name: string; sas: string[]; fingerprint: string }>> {
    const { unlocked, owner } = this.requireOwner(spaceId)
    const remote = await this.fetchRemote(spaceId)
    const known = new Set(unlocked.keyring.recipients.map((r) => r.id))
    return Promise.all(
      remote.pending
        .filter((p) => !known.has(p.id))
        .map(async (p) => ({
          id: p.id,
          name: p.name,
          sas: await pairingCode(owner.ownerIdentity.signPk, p),
          fingerprint: await fingerprint(p)
        }))
    )
  }

  private async removePending(spaceId: string, requestId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('Invalid request')
    const raw = await this.deps.rawStoreFor(spaceId)
    await raw.open()
    try {
      await raw.remove(`${PENDING_DIR}/${requestId}.json`)
      await raw.commit({ changed: [], removed: [] })
    } finally {
      await raw.close()
    }
  }

  async approve(spaceId: string, requestId: string, kind: RecipientKind, role: RecipientRole): Promise<KbCryptoStatus> {
    const { unlocked, owner } = this.requireOwner(spaceId)
    const remote = await this.fetchRemote(spaceId)
    const identity = remote.pending.find((p) => p.id === requestId)
    if (!identity) throw new Error('The request is gone. Ask the device to request access again.')
    const keyring = await addRecipient(unlocked.keyring, owner, identity, kind, kind === 'device' ? 'admin' : role)
    await this.removePending(spaceId, requestId)
    await this.saveKeyringChange(spaceId, keyring)
    return this.status(spaceId)
  }

  async reject(spaceId: string, requestId: string): Promise<KbCryptoStatus> {
    this.requireOwner(spaceId)
    await this.removePending(spaceId, requestId)
    return this.status(spaceId)
  }

  async pairingCheck(spaceId: string): Promise<{ words: string[]; deviceName: string } | null> {
    const state = this.state(spaceId)
    if (!state || state.trusted.length > 0) return null
    const remote = await this.fetchRemote(spaceId)
    if (!remote.keyring) return null
    const device = await this.device()
    if (!remote.keyring.recipients.some((r) => r.id === device.id && r.signPk === device.signPk)) return null
    return { words: await pairingCode(remote.keyring.signer, publicPart(device)), deviceName: device.name }
  }

  async confirmPairing(spaceId: string): Promise<KbCryptoStatus> {
    const state = this.state(spaceId)
    if (!state) throw new Error('This space is not encrypted on this device')
    const remote = await this.fetchRemote(spaceId)
    if (!remote.keyring) throw new Error('No keyring on the remote')
    const verdict = await verifyKeyring(remote.keyring, [remote.keyring.signer])
    if (!verdict.ok) throw new Error(verdict.reason)
    this.writeLocalKeyring(spaceId, remote.keyring)
    this.saveState(spaceId, { ...state, lastEpoch: remote.keyring.epoch, trusted: keyringSigners(remote.keyring) })
    if (!(await this.ensureUnlocked(spaceId))) throw new Error('This device has no access yet')
    this.deps.triggerSync(spaceId)
    return this.status(spaceId)
  }

  async status(spaceId: string): Promise<KbCryptoStatus> {
    const space = this.kb.getSpace(spaceId)
    const unlocked = this.unlocked.get(spaceId)
    const keyring = unlocked?.keyring ?? this.readLocalKeyring(spaceId)
    const device = space.encrypted ? await this.device() : this.sessionDevice
    const state = this.state(spaceId)
    const recipients = keyring?.recipients ?? []
    let pendingPairings: KbCryptoStatus['pendingPairings'] = []
    if (unlocked?.owner) pendingPairings = await this.listPending(spaceId).catch(() => [])
    return {
      enabled: space.encrypted,
      unlocked: !!unlocked,
      deviceId: device?.id ?? null,
      deviceName: device?.name ?? null,
      canRememberOnDevice: space.encrypted || process.platform === 'linux' ? osKeychainUsable() : true,
      remembered: !!device && recipients.some((r) => r.id === device.id),
      members: await Promise.all(
        recipients
          .filter((r) => r.kind === 'member')
          .map(async (r) => ({ id: r.id, name: r.name, role: r.role, fingerprint: await fingerprint(r), isMe: r.id === device?.id }))
      ),
      devices: await Promise.all(
        recipients
          .filter((r) => r.kind === 'device')
          .map(async (r) => ({ id: r.id, name: r.name, fingerprint: await fingerprint(r), isMe: r.id === device?.id }))
      ),
      pendingPairings,
      lastSeq: state?.lastSeq ?? 0
    }
  }

  async wrapStore(spaceId: string, raw: RemoteStore): Promise<RemoteStore> {
    const unlocked = this.unlocked.get(spaceId)
    const state = this.state(spaceId)
    if (!unlocked || !state) throw new Error('The space is locked')
    const device = await this.device()
    const deviceIsRecipient = unlocked.keyring.recipients.some((r) => r.id === device.id && r.signPk === device.signPk)
    const signer = deviceIsRecipient ? device : unlocked.owner?.ownerIdentity
    if (!signer) throw new Error('This device cannot sign changes for the space')
    return new EncryptedStore(raw, {
      spaceId: state.cryptoSpaceId,
      keyring: unlocked.keyring,
      spaceKey: unlocked.spaceKey,
      signer,
      state,
      reencrypt: !!unlocked.owner,
      onKeyring: (keyring) => {
        this.writeLocalKeyring(spaceId, keyring)
        const current = this.unlocked.get(spaceId)
        if (current) this.setUnlocked(spaceId, keyring, current.spaceKey, current.owner)
      },
      onCommitted: (next) => this.saveState(spaceId, { ...next, cryptoSpaceId: state.cryptoSpaceId })
    })
  }

  gitMirrorStore(spaceId: string, remoteUrl: string, branch: string, auth?: GitAuth): RemoteStore {
    return new GitMirrorStore(join(APP_DATA_DIR, 'kb-mirrors', spaceId), remoteUrl, branch, auth)
  }
}
