import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  addRecipient,
  changePassphrase,
  createKeyring,
  removeRecipientAndRotate,
  unlockWithDevice,
  unlockWithPassphrase,
  unlockWithRecovery,
  verifyKeyring,
  type Keyring,
  type OwnerSecrets
} from '../src/main/kb/crypto/keyring'
import { createIdentity, pairingCode, publicPart, fingerprint } from '../src/main/kb/crypto/identity'
import { EncryptedStore, MANIFEST_FILE, KEYRING_FILE, type CryptoState } from '../src/main/kb/crypto/encrypted-store'
import { checkFreshness, RollbackError } from '../src/main/kb/crypto/manifest'
import { DecryptionError } from '../src/main/kb/crypto/primitives'
import { FsStore } from '../src/main/kb/sync/fs-store'
import { syncThreeWay, type SyncState } from '../src/main/kb/sync/three-way'

const FAST = { ops: 1, mem: 8 * 1024 * 1024 }
const SPACE = '11111111-2222-3333-4444-555555555555'

let base: string
let remote: string
let mac: string

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}

function allRemoteBytes(): Buffer {
  const out: Buffer[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(Buffer.from(name), readFileSync(full))
    }
  }
  walk(remote)
  return Buffer.concat(out)
}

interface Device {
  root: string
  state: SyncState
  crypto: CryptoState
  keyring: Keyring
  spaceKey: Uint8Array
  signer: { signPk: string; signSk: string }
}

async function sync(device: Device): Promise<ReturnType<typeof syncThreeWay> extends Promise<infer R> ? R['report'] : never> {
  const store = new EncryptedStore(new FsStore(remote, device.root), {
    spaceId: SPACE,
    keyring: device.keyring,
    spaceKey: device.spaceKey,
    signer: device.signer,
    state: device.crypto,
    onKeyring: (k) => (device.keyring = k),
    onCommitted: (s) => (device.crypto = s)
  })
  const result = await syncThreeWay(device.root, store, device.state, {
    machineName: 'test',
    blockSecrets: false,
    now: () => new Date(2026, 10, 23, 12, 0)
  })
  device.state = result.state
  return result.report
}

let owner: OwnerSecrets
let keyring: Keyring
let words: string[]

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'sge-crypt-'))
  remote = join(base, 'nas')
  mac = join(base, 'mac')
  mkdirSync(remote)
  mkdirSync(mac)
  const created = await createKeyring(SPACE, 'correct horse battery staple', { argon: FAST })
  owner = created.secrets
  keyring = created.keyring
  words = created.recoveryWords
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

const macDevice = (): Device => ({
  root: mac,
  state: new Map(),
  crypto: { lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] },
  keyring,
  spaceKey: owner.spaceKey,
  signer: owner.ownerIdentity
})

describe('keyring', () => {
  it('unlocks with the passphrase or the 24 recovery words, and rejects a wrong passphrase clearly', async () => {
    expect(words).toHaveLength(24)
    expect(Buffer.from((await unlockWithPassphrase(keyring, 'correct horse battery staple')).spaceKey)).toEqual(
      Buffer.from(owner.spaceKey)
    )
    expect(Buffer.from((await unlockWithRecovery(keyring, words.join('  '))).spaceKey)).toEqual(Buffer.from(owner.spaceKey))
    await expect(unlockWithPassphrase(keyring, 'wrong')).rejects.toThrow('Wrong passphrase')
    await expect(unlockWithRecovery(keyring, words.slice(0, 23).concat('abandon'))).rejects.toBeInstanceOf(DecryptionError)
  })

  it('rejects any altered byte of the keyring', async () => {
    expect((await verifyKeyring(keyring, [])).ok).toBe(true)
    const tampered = { ...keyring, rev: keyring.rev + 1 }
    expect((await verifyKeyring(tampered, [])).ok).toBe(false)
  })

  it('refuses a keyring signed by a key the device does not trust', async () => {
    const forged = await createKeyring(SPACE, 'attacker', { argon: FAST })
    expect((await verifyKeyring(forged.keyring, [keyring.ownerSignPk])).ok).toBe(false)
  })

  it('gives a paired device the space key, and owner powers only to the owner devices', async () => {
    const laptop = await createIdentity('laptop')
    const friend = await createIdentity('ana')
    let k = await addRecipient(keyring, owner, publicPart(laptop), 'device', 'admin')
    k = await addRecipient(k, owner, publicPart(friend), 'member', 'reader')
    const viaLaptop = await unlockWithDevice(k, laptop)
    expect(Buffer.from(viaLaptop.spaceKey)).toEqual(Buffer.from(owner.spaceKey))
    expect(viaLaptop.owner).not.toBeNull()
    const viaFriend = await unlockWithDevice(k, friend)
    expect(viaFriend.owner).toBeNull()
    await expect(addRecipient(k, owner, publicPart(friend), 'member', 'admin')).rejects.toThrow(/writers or readers/)
  })

  it('rotates the key when someone is removed so their old key no longer opens the space', async () => {
    const friend = await createIdentity('ana')
    const withFriend = await addRecipient(keyring, owner, publicPart(friend), 'member', 'writer')
    const rotated = await removeRecipientAndRotate(withFriend, owner, friend.id)
    expect(rotated.keyring.epoch).toBe(2)
    expect(Buffer.from(rotated.spaceKey)).not.toEqual(Buffer.from(owner.spaceKey))
    await expect(unlockWithDevice(rotated.keyring, friend)).rejects.toBeInstanceOf(DecryptionError)
    const again = await unlockWithPassphrase(rotated.keyring, 'correct horse battery staple')
    expect(Buffer.from(again.spaceKey)).toEqual(Buffer.from(rotated.spaceKey))
  })

  it('keeps working after a passphrase change, and the old passphrase stops working', async () => {
    const changed = await changePassphrase(keyring, owner, 'nueva frase larga y segura', FAST)
    await expect(unlockWithPassphrase(changed, 'correct horse battery staple')).rejects.toThrow('Wrong passphrase')
    expect((await unlockWithPassphrase(changed, 'nueva frase larga y segura')).spaceKey).toBeTruthy()
  })

  it('shows the same 6 word pairing code on both devices only for the real keys', async () => {
    const requester = await createIdentity('nuevo')
    const code = await pairingCode(owner.ownerIdentity.signPk, publicPart(requester))
    expect(code).toHaveLength(6)
    expect(await pairingCode(owner.ownerIdentity.signPk, publicPart(requester))).toEqual(code)
    const impostor = await createIdentity('nuevo')
    expect(await pairingCode(owner.ownerIdentity.signPk, { ...publicPart(requester), xPk: impostor.xPk })).not.toEqual(code)
    expect((await fingerprint(publicPart(requester))).split('-')).toHaveLength(4)
  })
})

describe('encrypted sync', () => {
  it('leaves no path, title or sentence of the vault on the remote', async () => {
    put(mac, 'people/ana-garcia.md', '# Ana García\n\nTeléfono privado y notas confidenciales sobre el proyecto Atalaya.\n')
    put(mac, 'decisions/2026-11-23-cifrado.md', '---\ntags: [decision]\n---\n\n# Decisión de cifrado\n')
    const device = macDevice()
    const report = await sync(device)
    expect(report.pushed.sort()).toEqual(['decisions/2026-11-23-cifrado.md', 'people/ana-garcia.md'])
    const blob = allRemoteBytes().toString('latin1')
    for (const needle of ['ana-garcia', 'Ana Garc', 'people', 'decisions', 'cifrado', 'Atalaya', 'confidenciales', 'decision']) {
      expect(blob.includes(needle), needle).toBe(false)
    }
  })

  it('round-trips to a second device that only has the passphrase', async () => {
    put(mac, 'a.md', 'secreto compartido\n')
    await sync(macDevice())
    const win = join(base, 'win')
    mkdirSync(win)
    const unlocked = await unlockWithPassphrase(
      JSON.parse(readFileSync(join(remote, KEYRING_FILE), 'utf-8')) as Keyring,
      'correct horse battery staple'
    )
    const winDevice: Device = {
      root: win,
      state: new Map(),
      crypto: { lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] },
      keyring,
      spaceKey: unlocked.spaceKey,
      signer: unlocked.ownerIdentity
    }
    expect((await sync(winDevice)).pulled).toEqual(['a.md'])
    expect(readFileSync(join(win, 'a.md'), 'utf-8')).toBe('secreto compartido\n')
  })

  it('detects an altered object, a swapped object and an altered manifest', async () => {
    put(mac, 'a.md', 'uno')
    put(mac, 'b.md', 'dos')
    const device = macDevice()
    await sync(device)
    const objects: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else objects.push(full)
      }
    }
    walk(join(remote, 'objects'))
    const [first, second] = objects
    const original = readFileSync(first)
    writeFileSync(first, readFileSync(second))
    writeFileSync(second, original)
    rmSync(join(mac, 'a.md'))
    rmSync(join(mac, 'b.md'))
    device.state = new Map()
    await expect(sync(device)).rejects.toBeInstanceOf(DecryptionError)

    writeFileSync(second, readFileSync(first))
    const manifest = JSON.parse(readFileSync(join(remote, MANIFEST_FILE), 'utf-8'))
    manifest.ct = manifest.ct.slice(0, -4) + 'AAAA'
    writeFileSync(join(remote, MANIFEST_FILE), JSON.stringify(manifest))
    await expect(sync(device)).rejects.toThrow(/signature is not valid/)
  })

  it('stops when the server serves an older manifest than the device already saw', async () => {
    put(mac, 'a.md', 'v1')
    const device = macDevice()
    await sync(device)
    const old = readFileSync(join(remote, MANIFEST_FILE))
    put(mac, 'a.md', 'v2')
    await sync(device)
    writeFileSync(join(remote, MANIFEST_FILE), old)
    await expect(sync(device)).rejects.toBeInstanceOf(RollbackError)
  })

  it('rejects manifests published by a reader', async () => {
    const friend = await createIdentity('ana')
    keyring = await addRecipient(keyring, owner, publicPart(friend), 'member', 'reader')
    put(mac, 'a.md', 'del propietario')
    await sync(macDevice())
    const friendRoot = join(base, 'friend')
    mkdirSync(friendRoot)
    const access = await unlockWithDevice(keyring, friend)
    const friendDevice: Device = {
      root: friendRoot,
      state: new Map(),
      crypto: { lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] },
      keyring,
      spaceKey: access.spaceKey,
      signer: friend
    }
    await sync(friendDevice)
    put(friendRoot, 'a.md', 'cambiado por una lectora')
    await sync(friendDevice)
    const device = macDevice()
    device.crypto = { lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] }
    await expect(sync(device)).rejects.toThrow(/without write access/)
  })

  it('refuses to encrypt into a destination that already holds plain notes', async () => {
    put(remote, 'old-plain.md', 'plain')
    put(mac, 'a.md', 'x')
    await expect(sync(macDevice())).rejects.toThrow(/not encrypted/)
  })
})

describe('freshness rules', () => {
  it('accepts the next version, rejects forks and rollbacks', () => {
    expect(() => checkFreshness({ seq: 3, hash: 'h3' }, { seq: 4, prev: 'h3', hash: 'h4' })).not.toThrow()
    expect(() => checkFreshness({ seq: 3, hash: 'h3' }, { seq: 4, prev: 'other', hash: 'h4' })).toThrow(RollbackError)
    expect(() => checkFreshness({ seq: 3, hash: 'h3' }, { seq: 3, prev: 'h2', hash: 'x' })).toThrow(RollbackError)
    expect(() => checkFreshness({ seq: 3, hash: 'h3' }, { seq: 2, prev: 'h1', hash: 'h2' })).toThrow(RollbackError)
  })
})

describe('encrypted sync over git', () => {
  it('pushes only ciphertext with a neutral author and another device reads it back', async () => {
    const { createFixture, git } = await import('./helpers/git-fixture')
    const { GitMirrorStore } = await import('../src/main/kb/sync/git-mirror-store')
    const fx = createFixture()
    try {
      const bare = join(fx.root, 'nas.git')
      mkdirSync(bare)
      await git(bare, 'init', '-q', '--bare', '-b', 'main')
      put(mac, 'people/ana.md', '# Ana\n\nNota privada.\n')
      const run = async (root: string, mirror: string, state: { s: SyncState; c: CryptoState }) => {
        const store = new EncryptedStore(new GitMirrorStore(mirror, bare, 'main'), {
          spaceId: SPACE,
          keyring,
          spaceKey: owner.spaceKey,
          signer: owner.ownerIdentity,
          state: state.c,
          onKeyring: () => {},
          onCommitted: (c) => (state.c = c)
        })
        const result = await syncThreeWay(root, store, state.s, { machineName: 'm', blockSecrets: false })
        state.s = result.state
        return result.report
      }
      const macState = { s: new Map() as SyncState, c: { lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] } as CryptoState }
      expect((await run(mac, join(fx.root, 'mirror-mac'), macState)).pushed).toEqual(['people/ana.md'])
      const files = await git(bare, 'ls-tree', '-r', '--name-only', 'main')
      expect(files).not.toMatch(/ana|people/)
      expect(await git(bare, 'log', '-1', '--format=%an %s', 'main')).toBe('sge-kb sync')
      const win = join(base, 'win-git')
      mkdirSync(win)
      const winState = { s: new Map() as SyncState, c: { lastSeq: 0, lastHash: null, lastEpoch: 0, trusted: [] } as CryptoState }
      expect((await run(win, join(fx.root, 'mirror-win'), winState)).pulled).toEqual(['people/ana.md'])
      expect(readFileSync(join(win, 'people/ana.md'), 'utf-8')).toContain('Nota privada')
    } finally {
      fx.cleanup()
    }
  })
})
