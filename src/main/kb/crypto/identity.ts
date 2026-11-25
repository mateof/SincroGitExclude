import { wordlist } from '@scure/bip39/wordlists/english.js'
import { b64, generateKeys, keyedHash, unb64, type EncryptionKeys } from './primitives'
import { randomUUID } from 'crypto'

export interface PublicIdentity {
  id: string
  name: string
  xPk: string
  kemPk: string
  signPk: string
}

export interface PrivateIdentity extends PublicIdentity {
  xSk: string
  kemSk: string
  signSk: string
}

export async function createIdentity(name: string): Promise<PrivateIdentity> {
  const keys = await generateKeys()
  return {
    id: randomUUID(),
    name: name.trim().slice(0, 80) || 'device',
    xPk: b64(keys.xPk),
    kemPk: b64(keys.kemPk),
    signPk: b64(keys.signPk),
    xSk: b64(keys.xSk),
    kemSk: b64(keys.kemSk),
    signSk: b64(keys.signSk)
  }
}

export function publicPart(identity: PrivateIdentity | PublicIdentity): PublicIdentity {
  return { id: identity.id, name: identity.name, xPk: identity.xPk, kemPk: identity.kemPk, signPk: identity.signPk }
}

export function keysOf(identity: PrivateIdentity): EncryptionKeys {
  return {
    xPk: unb64(identity.xPk),
    xSk: unb64(identity.xSk),
    kemPk: unb64(identity.kemPk),
    kemSk: unb64(identity.kemSk),
    signPk: unb64(identity.signPk),
    signSk: unb64(identity.signSk)
  }
}

export function isPublicIdentity(value: unknown): value is PublicIdentity {
  const v = value as PublicIdentity | null
  return (
    !!v &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.xPk === 'string' &&
    unb64(v.xPk).length === 32 &&
    typeof v.kemPk === 'string' &&
    unb64(v.kemPk).length === 1184 &&
    typeof v.signPk === 'string' &&
    unb64(v.signPk).length === 32
  )
}

function wordsFrom(digest: Uint8Array, count: number): string[] {
  const words: string[] = []
  let bits = 0
  let acc = 0
  let i = 0
  while (words.length < count) {
    acc = (acc << 8) | digest[i++]
    bits += 8
    if (bits >= 11) {
      bits -= 11
      words.push(wordlist[(acc >> bits) & 0x7ff])
    }
  }
  return words
}

export async function fingerprint(identity: PublicIdentity): Promise<string> {
  const digest = await keyedHash(null, 'SGEKB-fingerprint-v1', unb64(identity.signPk), unb64(identity.xPk), unb64(identity.kemPk))
  return wordsFrom(digest, 4).join('-')
}

export async function pairingCode(approverSignPk: string, requester: PublicIdentity): Promise<string[]> {
  const digest = await keyedHash(
    null,
    'SGEKB-pairing-v1',
    unb64(approverSignPk),
    unb64(requester.signPk),
    unb64(requester.xPk),
    unb64(requester.kemPk)
  )
  return wordsFrom(digest, 6)
}
