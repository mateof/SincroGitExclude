import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import {
  DEFAULT_ARGON,
  DecryptionError,
  b64,
  canonicalJson,
  hex,
  keyedHash,
  open,
  passphraseKey,
  randomBytes,
  seal,
  sign,
  unb64,
  unwrapWith,
  verify,
  wrapFor,
  type ArgonParams,
  type HybridWrap
} from './primitives'
import { createIdentity, keysOf, publicPart, type PrivateIdentity, type PublicIdentity } from './identity'

export type RecipientRole = 'admin' | 'writer' | 'reader'
export type RecipientKind = 'device' | 'member'

export interface Sealed {
  nonce: string
  ct: string
}

export interface Recipient extends PublicIdentity {
  kind: RecipientKind
  role: RecipientRole
  addedAt: string
  key: HybridWrap
  owner?: HybridWrap
}

export interface KeyringBody {
  format: 'sgekb-keyring'
  version: 1
  spaceId: string
  rev: number
  epoch: number
  keyId: string
  ownerSignPk: string
  owner: {
    passphrase: (Sealed & { salt: string; ops: number; mem: number }) | null
    recovery: Sealed | null
    key: Sealed
    identity: Sealed
  }
  recipients: Recipient[]
  history: Array<Sealed & { epoch: number; keyId: string }>
  updatedAt: string
}

export interface Keyring extends KeyringBody {
  signer: string
  sig: string
}

export interface OwnerSecrets {
  ownerKey: Uint8Array
  spaceKey: Uint8Array
  ownerIdentity: PrivateIdentity
}

export interface Signer {
  signPk: string
  signSk: string
}

const ad = {
  passphrase: (s: string) => `sgekb:${s}:owner:passphrase`,
  recovery: (s: string) => `sgekb:${s}:owner:recovery`,
  identity: (s: string) => `sgekb:${s}:owner:identity`,
  key: (s: string, epoch: number, keyId: string) => `sgekb:${s}:key:${epoch}:${keyId}`,
  recipientKey: (s: string, id: string, epoch: number) => `sgekb:${s}:recipient:${id}:key:${epoch}`,
  recipientOwner: (s: string, id: string) => `sgekb:${s}:recipient:${id}:owner`,
  history: (s: string, epoch: number, keyId: string, current: number) => `sgekb:${s}:history:${epoch}:${keyId}:${current}`
}

const sealedOf = (x: { nonce: Uint8Array; ct: Uint8Array }): Sealed => ({ nonce: b64(x.nonce), ct: b64(x.ct) })
const openSealed = (key: Uint8Array, s: Sealed, a: string): Promise<Uint8Array> => open(key, unb64(s.nonce), unb64(s.ct), a)

function bodyOf(keyring: Keyring | KeyringBody): KeyringBody {
  const { signer: _s, sig: _g, ...body } = keyring as Keyring
  return body
}

export async function signKeyring(body: KeyringBody, signer: Signer): Promise<Keyring> {
  const sig = await sign(unb64(signer.signSk), canonicalJson(body))
  return { ...body, signer: signer.signPk, sig }
}

export function keyringSigners(keyring: KeyringBody): string[] {
  return [keyring.ownerSignPk, ...keyring.recipients.filter((r) => r.role === 'admin').map((r) => r.signPk)]
}

export async function verifyKeyring(keyring: Keyring, trusted: string[]): Promise<{ ok: boolean; reason?: string }> {
  if (keyring.format !== 'sgekb-keyring' || keyring.version !== 1) return { ok: false, reason: 'Unknown keyring format' }
  if (!keyringSigners(keyring).includes(keyring.signer)) return { ok: false, reason: 'The keyring is signed by someone who is not an admin' }
  if (!(await verify(unb64(keyring.signer), canonicalJson(bodyOf(keyring)), keyring.sig))) {
    return { ok: false, reason: 'The keyring signature is not valid: it was altered' }
  }
  if (trusted.length > 0 && !trusted.includes(keyring.signer)) {
    return { ok: false, reason: 'The keyring was signed by a key this device does not trust' }
  }
  return { ok: true }
}

export function generateRecoveryWords(entropy: Uint8Array): string[] {
  return entropyToMnemonic(entropy, wordlist).split(' ')
}

async function recoveryKek(words: string[] | string): Promise<Uint8Array> {
  const phrase = (Array.isArray(words) ? words.join(' ') : words).trim().toLowerCase().replace(/\s+/g, ' ')
  if (!validateMnemonic(phrase, wordlist)) throw new DecryptionError('The recovery code is not valid: check the 24 words')
  return keyedHash(null, 'SGEKB-recovery-v1', mnemonicToEntropy(phrase, wordlist))
}

export async function createKeyring(
  spaceId: string,
  passphrase: string,
  options: { argon?: ArgonParams; device?: PrivateIdentity | null; now?: Date } = {}
): Promise<{ keyring: Keyring; secrets: OwnerSecrets; recoveryWords: string[] }> {
  const argon = options.argon ?? DEFAULT_ARGON
  const ownerKey = await randomBytes(32)
  const spaceKey = await randomBytes(32)
  const keyId = hex(await randomBytes(8))
  const ownerIdentity = await createIdentity('owner')
  const salt = await randomBytes(16)
  const passKek = await passphraseKey(passphrase, salt, argon)
  const entropy = await randomBytes(32)
  const recoveryWords = generateRecoveryWords(entropy)
  const recKek = await recoveryKek(recoveryWords)
  const body: KeyringBody = {
    format: 'sgekb-keyring',
    version: 1,
    spaceId,
    rev: 1,
    epoch: 1,
    keyId,
    ownerSignPk: ownerIdentity.signPk,
    owner: {
      passphrase: { ...sealedOf(await seal(passKek, ownerKey, ad.passphrase(spaceId))), salt: b64(salt), ops: argon.ops, mem: argon.mem },
      recovery: sealedOf(await seal(recKek, ownerKey, ad.recovery(spaceId))),
      key: sealedOf(await seal(ownerKey, spaceKey, ad.key(spaceId, 1, keyId))),
      identity: sealedOf(await seal(ownerKey, Buffer.from(JSON.stringify(ownerIdentity)), ad.identity(spaceId)))
    },
    recipients: [],
    history: [],
    updatedAt: (options.now ?? new Date()).toISOString()
  }
  if (options.device) {
    body.recipients.push(await buildRecipient(body, spaceKey, ownerKey, publicPart(options.device), 'device', 'admin'))
  }
  const keyring = await signKeyring(body, ownerIdentity)
  return { keyring, secrets: { ownerKey, spaceKey, ownerIdentity }, recoveryWords }
}

async function buildRecipient(
  body: KeyringBody,
  spaceKey: Uint8Array,
  ownerKey: Uint8Array | null,
  identity: PublicIdentity,
  kind: RecipientKind,
  role: RecipientRole
): Promise<Recipient> {
  const target = { xPk: unb64(identity.xPk), kemPk: unb64(identity.kemPk) }
  const recipient: Recipient = {
    ...identity,
    kind,
    role,
    addedAt: new Date().toISOString(),
    key: await wrapFor(target, spaceKey, ad.recipientKey(body.spaceId, identity.id, body.epoch))
  }
  if (kind === 'device' && role === 'admin' && ownerKey) {
    recipient.owner = await wrapFor(target, ownerKey, ad.recipientOwner(body.spaceId, identity.id))
  }
  return recipient
}

async function openOwner(keyring: KeyringBody, ownerKey: Uint8Array): Promise<OwnerSecrets> {
  const spaceKey = await openSealed(ownerKey, keyring.owner.key, ad.key(keyring.spaceId, keyring.epoch, keyring.keyId))
  const identityBytes = await openSealed(ownerKey, keyring.owner.identity, ad.identity(keyring.spaceId))
  const ownerIdentity = JSON.parse(Buffer.from(identityBytes).toString('utf-8')) as PrivateIdentity
  if (ownerIdentity.signPk !== keyring.ownerSignPk) throw new DecryptionError('The owner identity does not match the keyring')
  return { ownerKey, spaceKey, ownerIdentity }
}

export async function unlockWithPassphrase(keyring: KeyringBody, passphrase: string): Promise<OwnerSecrets> {
  const slot = keyring.owner.passphrase
  if (!slot) throw new DecryptionError('This space has no passphrase')
  const kek = await passphraseKey(passphrase, unb64(slot.salt), { ops: slot.ops, mem: slot.mem })
  let ownerKey: Uint8Array
  try {
    ownerKey = await openSealed(kek, slot, ad.passphrase(keyring.spaceId))
  } catch {
    throw new DecryptionError('Wrong passphrase')
  }
  return openOwner(keyring, ownerKey)
}

export async function unlockWithRecovery(keyring: KeyringBody, words: string[] | string): Promise<OwnerSecrets> {
  const slot = keyring.owner.recovery
  if (!slot) throw new DecryptionError('This space has no recovery code')
  const kek = await recoveryKek(words)
  let ownerKey: Uint8Array
  try {
    ownerKey = await openSealed(kek, slot, ad.recovery(keyring.spaceId))
  } catch {
    throw new DecryptionError('Wrong recovery code')
  }
  return openOwner(keyring, ownerKey)
}

export async function unlockWithDevice(
  keyring: KeyringBody,
  device: PrivateIdentity
): Promise<{ spaceKey: Uint8Array; owner: OwnerSecrets | null; recipient: Recipient }> {
  const recipient = keyring.recipients.find((r) => r.id === device.id && r.signPk === device.signPk)
  if (!recipient) throw new DecryptionError('This device has no access to the space yet')
  const keys = keysOf(device)
  const spaceKey = await unwrapWith(keys, recipient.key, ad.recipientKey(keyring.spaceId, recipient.id, keyring.epoch))
  let owner: OwnerSecrets | null = null
  if (recipient.owner) {
    const ownerKey = await unwrapWith(keys, recipient.owner, ad.recipientOwner(keyring.spaceId, recipient.id))
    owner = await openOwner(keyring, ownerKey)
  }
  return { spaceKey, owner, recipient }
}

function bump(body: KeyringBody): KeyringBody {
  return { ...body, rev: body.rev + 1, updatedAt: new Date().toISOString() }
}

export async function addRecipient(
  keyring: Keyring,
  owner: OwnerSecrets,
  identity: PublicIdentity,
  kind: RecipientKind,
  role: RecipientRole
): Promise<Keyring> {
  if (kind === 'member' && role === 'admin') throw new Error('People other than the owner can be writers or readers, not admins')
  const body = bump(bodyOf(keyring))
  body.recipients = body.recipients.filter((r) => r.id !== identity.id)
  body.recipients.push(await buildRecipient(body, owner.spaceKey, owner.ownerKey, identity, kind, role))
  return signKeyring(body, owner.ownerIdentity)
}

export async function removeRecipientAndRotate(
  keyring: Keyring,
  owner: OwnerSecrets,
  recipientId: string
): Promise<{ keyring: Keyring; spaceKey: Uint8Array }> {
  const body = bump(bodyOf(keyring))
  const remaining = body.recipients.filter((r) => r.id !== recipientId)
  if (remaining.length === body.recipients.length) throw new Error('Unknown device or person')
  return rotate({ ...body, recipients: remaining }, owner)
}

export async function rotate(body: KeyringBody, owner: OwnerSecrets): Promise<{ keyring: Keyring; spaceKey: Uint8Array }> {
  const oldKey = owner.spaceKey
  const oldHistory = await Promise.all(
    body.history.map(async (h) => ({ ...h, key: await openSealed(oldKey, h, ad.history(body.spaceId, h.epoch, h.keyId, body.epoch)) }))
  )
  const newKey = await randomBytes(32)
  const next: KeyringBody = { ...body, epoch: body.epoch + 1, keyId: hex(await randomBytes(8)) }
  next.history = [
    ...(await Promise.all(
      oldHistory.map(async (h) => ({
        epoch: h.epoch,
        keyId: h.keyId,
        ...sealedOf(await seal(newKey, h.key, ad.history(next.spaceId, h.epoch, h.keyId, next.epoch)))
      }))
    )),
    {
      epoch: body.epoch,
      keyId: body.keyId,
      ...sealedOf(await seal(newKey, oldKey, ad.history(next.spaceId, body.epoch, body.keyId, next.epoch)))
    }
  ]
  next.owner = { ...next.owner, key: sealedOf(await seal(owner.ownerKey, newKey, ad.key(next.spaceId, next.epoch, next.keyId))) }
  next.recipients = await Promise.all(
    next.recipients.map(async (r) => ({
      ...r,
      key: await wrapFor({ xPk: unb64(r.xPk), kemPk: unb64(r.kemPk) }, newKey, ad.recipientKey(next.spaceId, r.id, next.epoch))
    }))
  )
  return { keyring: await signKeyring(next, owner.ownerIdentity), spaceKey: newKey }
}

export async function changePassphrase(keyring: Keyring, owner: OwnerSecrets, passphrase: string, argon: ArgonParams = DEFAULT_ARGON): Promise<Keyring> {
  const body = bump(bodyOf(keyring))
  const salt = await randomBytes(16)
  const kek = await passphraseKey(passphrase, salt, argon)
  body.owner = {
    ...body.owner,
    passphrase: { ...sealedOf(await seal(kek, owner.ownerKey, ad.passphrase(body.spaceId))), salt: b64(salt), ops: argon.ops, mem: argon.mem }
  }
  return signKeyring(body, owner.ownerIdentity)
}

export async function resetRecovery(keyring: Keyring, owner: OwnerSecrets): Promise<{ keyring: Keyring; words: string[] }> {
  const body = bump(bodyOf(keyring))
  const words = generateRecoveryWords(await randomBytes(32))
  body.owner = { ...body.owner, recovery: sealedOf(await seal(await recoveryKek(words), owner.ownerKey, ad.recovery(body.spaceId))) }
  return { keyring: await signKeyring(body, owner.ownerIdentity), words }
}

export async function keyForEpoch(keyring: KeyringBody, spaceKey: Uint8Array, epoch: number): Promise<Uint8Array> {
  if (epoch === keyring.epoch) return spaceKey
  const entry = keyring.history.find((h) => h.epoch === epoch)
  if (!entry) throw new DecryptionError(`No key for epoch ${epoch}`)
  return openSealed(spaceKey, entry, ad.history(keyring.spaceId, entry.epoch, entry.keyId, keyring.epoch))
}

export function recipientFor(keyring: KeyringBody, signPk: string): Recipient | 'owner' | null {
  if (signPk === keyring.ownerSignPk) return 'owner'
  return keyring.recipients.find((r) => r.signPk === signPk) ?? null
}

export function canWrite(keyring: KeyringBody, signPk: string): boolean {
  const who = recipientFor(keyring, signPk)
  return who === 'owner' || (who !== null && (who.role === 'admin' || who.role === 'writer'))
}
