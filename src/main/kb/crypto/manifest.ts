import { b64, canonicalJson, deriveSubkey, hex, keyedHash, open, seal, sign, unb64, verify, DecryptionError } from './primitives'
import { canWrite, type KeyringBody } from './keyring'

export interface ManifestEntry {
  id: string
  size: number
  hash: string
  v: number
  e: number
}

export interface ManifestBody {
  spaceId: string
  seq: number
  prev: string | null
  epoch: number
  at: string
  entries: Record<string, ManifestEntry>
}

export interface ManifestFile {
  format: 'sgekb-manifest'
  version: 1
  epoch: number
  signer: string
  nonce: string
  ct: string
  sig: string
}

export class RollbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RollbackError'
  }
}

export function emptyManifest(spaceId: string, epoch: number): ManifestBody {
  return { spaceId, seq: 0, prev: null, epoch, at: new Date(0).toISOString(), entries: {} }
}

export async function manifestKey(spaceKey: Uint8Array): Promise<Uint8Array> {
  return deriveSubkey(spaceKey, 3, 'SGEKBman')
}

const manifestAd = (spaceId: string, epoch: number): string => `sgekb:${spaceId}:manifest:${epoch}`

function signedPart(file: Omit<ManifestFile, 'sig'>): string {
  return canonicalJson({ format: file.format, version: file.version, epoch: file.epoch, signer: file.signer, nonce: file.nonce, ct: file.ct })
}

export async function encodeManifest(
  body: ManifestBody,
  spaceKey: Uint8Array,
  signer: { signPk: string; signSk: string }
): Promise<{ file: ManifestFile; bytes: Buffer; hash: string }> {
  const sealed = await seal(await manifestKey(spaceKey), Buffer.from(JSON.stringify(body)), manifestAd(body.spaceId, body.epoch))
  const unsigned = {
    format: 'sgekb-manifest' as const,
    version: 1 as const,
    epoch: body.epoch,
    signer: signer.signPk,
    nonce: b64(sealed.nonce),
    ct: b64(sealed.ct)
  }
  const file: ManifestFile = { ...unsigned, sig: await sign(unb64(signer.signSk), signedPart(unsigned)) }
  const bytes = Buffer.from(JSON.stringify(file))
  return { file, bytes, hash: await manifestHash(bytes) }
}

export async function manifestHash(bytes: Uint8Array): Promise<string> {
  return hex(await keyedHash(null, 'SGEKB-manifest-hash-v1', bytes))
}

export async function decodeManifest(
  bytes: Uint8Array,
  keyring: KeyringBody,
  keyFor: (epoch: number) => Promise<Uint8Array>
): Promise<{ body: ManifestBody; hash: string; signer: string }> {
  let file: ManifestFile
  try {
    file = JSON.parse(Buffer.from(bytes).toString('utf-8')) as ManifestFile
  } catch {
    throw new DecryptionError('The manifest is not readable')
  }
  if (file.format !== 'sgekb-manifest' || file.version !== 1) throw new DecryptionError('Unknown manifest format')
  if (!canWrite(keyring, file.signer)) throw new DecryptionError('The manifest was signed by someone without write access')
  if (!(await verify(unb64(file.signer), signedPart(file), file.sig))) {
    throw new DecryptionError('The manifest signature is not valid: it was altered')
  }
  const key = await manifestKey(await keyFor(file.epoch))
  const plain = await open(key, unb64(file.nonce), unb64(file.ct), manifestAd(keyring.spaceId, file.epoch))
  const body = JSON.parse(Buffer.from(plain).toString('utf-8')) as ManifestBody
  if (body.spaceId !== keyring.spaceId || body.epoch !== file.epoch) throw new DecryptionError('The manifest belongs to another space')
  return { body, hash: await manifestHash(bytes), signer: file.signer }
}

export function checkFreshness(
  last: { seq: number; hash: string | null },
  incoming: { seq: number; prev: string | null; hash: string }
): void {
  if (last.seq === 0 && !last.hash) return
  if (incoming.seq < last.seq) {
    throw new RollbackError(
      `The remote offers an older version of the space (${incoming.seq} < ${last.seq}). Someone may be serving old data: sync stopped.`
    )
  }
  if (incoming.seq === last.seq && incoming.hash !== last.hash) {
    throw new RollbackError('The remote version forked from the one this device saw: sync stopped.')
  }
  if (incoming.seq === last.seq + 1 && incoming.prev !== last.hash) {
    throw new RollbackError('The remote version does not follow the one this device saw: sync stopped.')
  }
}
