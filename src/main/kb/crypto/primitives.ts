import sodiumModule from 'libsodium-wrappers-sumo'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'

type Sodium = typeof sodiumModule

let ready: Promise<Sodium> | null = null

export function sodium(): Promise<Sodium> {
  if (!ready) {
    const mod = ((sodiumModule as unknown as { default?: Sodium }).default ?? sodiumModule) as Sodium
    ready = mod.ready.then(() => mod)
  }
  return ready
}

export const KEY_BYTES = 32
export const NONCE_BYTES = 24
export const PAD_BLOCK = 4096

export interface ArgonParams {
  ops: number
  mem: number
}

export const DEFAULT_ARGON: ArgonParams = { ops: 3, mem: 256 * 1024 * 1024 }

export const b64 = (data: Uint8Array): string => Buffer.from(data).toString('base64')
export const unb64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'))
export const hex = (data: Uint8Array): string => Buffer.from(data).toString('hex')

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed: wrong key or the data was altered') {
    super(message)
    this.name = 'DecryptionError'
  }
}

export async function randomBytes(n: number): Promise<Uint8Array> {
  return (await sodium()).randombytes_buf(n)
}

export async function seal(key: Uint8Array, plaintext: Uint8Array, ad: string): Promise<{ nonce: Uint8Array; ct: Uint8Array }> {
  const s = await sodium()
  const nonce = s.randombytes_buf(NONCE_BYTES)
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, ad, null, nonce, key)
  return { nonce, ct }
}

export async function open(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array, ad: string): Promise<Uint8Array> {
  const s = await sodium()
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, ad, nonce, key)
  } catch {
    throw new DecryptionError()
  }
}

export async function deriveSubkey(key: Uint8Array, id: number, context: string): Promise<Uint8Array> {
  if (context.length !== 8) throw new Error('KDF context must be 8 characters')
  return (await sodium()).crypto_kdf_derive_from_key(KEY_BYTES, id, context, key)
}

export async function keyedHash(key: Uint8Array | null, ...parts: Array<Uint8Array | string>): Promise<Uint8Array> {
  const s = await sodium()
  const chunks = parts.map((p) => (typeof p === 'string' ? s.from_string(p) : p))
  const total = chunks.reduce((n, c) => n + c.length + 4, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    new DataView(joined.buffer).setUint32(at, c.length)
    joined.set(c, at + 4)
    at += c.length + 4
  }
  return s.crypto_generichash(32, joined, key)
}

export async function passphraseKey(passphrase: string, salt: Uint8Array, params: ArgonParams): Promise<Uint8Array> {
  const s = await sodium()
  return s.crypto_pwhash(KEY_BYTES, passphrase.normalize('NFKC'), salt, params.ops, params.mem, s.crypto_pwhash_ALG_ARGON2ID13)
}

export async function pad(data: Uint8Array): Promise<Uint8Array> {
  return (await sodium()).pad(data, PAD_BLOCK)
}

export async function unpad(data: Uint8Array): Promise<Uint8Array> {
  try {
    return (await sodium()).unpad(data, PAD_BLOCK)
  } catch {
    throw new DecryptionError('Invalid padding')
  }
}

export interface EncryptionKeys {
  xPk: Uint8Array
  xSk: Uint8Array
  kemPk: Uint8Array
  kemSk: Uint8Array
  signPk: Uint8Array
  signSk: Uint8Array
}

export async function generateKeys(): Promise<EncryptionKeys> {
  const s = await sodium()
  const x = s.crypto_box_keypair()
  const sign = s.crypto_sign_keypair()
  const kem = ml_kem768.keygen()
  return {
    xPk: x.publicKey,
    xSk: x.privateKey,
    kemPk: kem.publicKey,
    kemSk: kem.secretKey,
    signPk: sign.publicKey,
    signSk: sign.privateKey
  }
}

export interface HybridWrap {
  ephPk: string
  kemCt: string
  nonce: string
  ct: string
}

async function hybridKek(
  ss1: Uint8Array,
  ss2: Uint8Array,
  ephPk: Uint8Array,
  recipientXPk: Uint8Array,
  kemCt: Uint8Array
): Promise<Uint8Array> {
  return keyedHash(null, 'SGEKB-hybrid-kem-v1', ss1, ss2, ephPk, recipientXPk, kemCt)
}

export async function wrapFor(
  recipient: { xPk: Uint8Array; kemPk: Uint8Array },
  secret: Uint8Array,
  ad: string
): Promise<HybridWrap> {
  const s = await sodium()
  const eph = s.crypto_box_keypair()
  const ss1 = s.crypto_scalarmult(eph.privateKey, recipient.xPk)
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipient.kemPk)
  const kek = await hybridKek(ss1, sharedSecret, eph.publicKey, recipient.xPk, cipherText)
  const sealed = await seal(kek, secret, ad)
  s.memzero(eph.privateKey)
  s.memzero(kek)
  return { ephPk: b64(eph.publicKey), kemCt: b64(cipherText), nonce: b64(sealed.nonce), ct: b64(sealed.ct) }
}

export async function unwrapWith(
  keys: Pick<EncryptionKeys, 'xPk' | 'xSk' | 'kemSk'>,
  wrap: HybridWrap,
  ad: string
): Promise<Uint8Array> {
  const s = await sodium()
  const ephPk = unb64(wrap.ephPk)
  const kemCt = unb64(wrap.kemCt)
  const ss1 = s.crypto_scalarmult(keys.xSk, ephPk)
  const ss2 = ml_kem768.decapsulate(kemCt, keys.kemSk)
  const kek = await hybridKek(ss1, ss2, ephPk, keys.xPk, kemCt)
  try {
    return await open(kek, unb64(wrap.nonce), unb64(wrap.ct), ad)
  } finally {
    s.memzero(kek)
  }
}

export async function sign(signSk: Uint8Array, message: Uint8Array | string): Promise<string> {
  const s = await sodium()
  return b64(s.crypto_sign_detached(typeof message === 'string' ? s.from_string(message) : message, signSk))
}

export async function verify(signPk: Uint8Array, message: Uint8Array | string, signature: string): Promise<boolean> {
  const s = await sodium()
  try {
    return s.crypto_sign_verify_detached(unb64(signature), typeof message === 'string' ? s.from_string(message) : message, signPk)
  } catch {
    return false
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export async function wipe(...buffers: Array<Uint8Array | null | undefined>): Promise<void> {
  const s = await sodium()
  for (const b of buffers) if (b) s.memzero(b)
}
