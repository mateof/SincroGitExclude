# Knowledge base encryption

Specification of the end-to-end encryption of knowledge spaces on remote storage. Code: `src/main/kb/crypto/` and `src/main/kb/kb-crypto-service.ts`. Tests: `test/kb-crypto.test.ts`.

## Threat model

**Protected against** whoever controls the remote storage: the git host, a compromised NAS, a cloud folder, a backup of any of them. That party can read everything stored, change any byte, delete files and serve old versions.

**Guarantees**

- Confidentiality of note contents, file names and folder structure.
- Integrity and authenticity of every file and of the list of files.
- Detection of rollbacks (an older version served as current) and forks.
- Roles: a reader can decrypt but other devices reject what a reader publishes.
- Key wrapping resistant to "harvest now, decrypt later" with a quantum computer: the remote keeps history for years.

**Not protected**

- Availability: the remote can delete everything. Git history and backups help.
- A compromised computer that has the space unlocked.
- The local copy, which stays plain so Obsidian can read it. Use FileVault or BitLocker.
- Metadata: number of objects, their padded sizes and when they change.

End-to-end encryption is meaningful here because the code that encrypts is the local app, not something served by the party being distrusted.

## Primitives

All from libsodium (`libsodium-wrappers-sumo`, WebAssembly) except ML-KEM (`@noble/post-quantum`).

| Use | Primitive |
|---|---|
| Content and manifest | XChaCha20-Poly1305 IETF, random 192-bit nonce |
| Passphrase | Argon2id, 3 passes, 256 MiB, 16-byte salt; parameters stored next to the slot |
| Subkeys | `crypto_kdf_derive_from_key` (BLAKE2b): `1/SGEKBobj` objects, `2/SGEKBnam` names, `3/SGEKBman` manifest |
| Object ids | keyed BLAKE2b-256 of the NFC-normalized path with the names subkey |
| Wrapping for devices and people | Hybrid KEM: X25519 + ML-KEM-768, combined with BLAKE2b over both secrets and the transcript (ephemeral key, recipient key, ML-KEM ciphertext) |
| Signatures | Ed25519 |
| Padding | `sodium_pad` to 4096-byte blocks |
| Recovery code | BIP39, 24 English words, 256 bits of entropy |

Every encryption carries associated data naming the space, the purpose and the version, so a ciphertext cannot be moved to another slot, object, version or space.

## Keys

- **K**, the space key: 32 random bytes. Encrypts objects and the manifest through its subkeys. Changes when someone loses access (a new epoch).
- **O**, the owner key: 32 random bytes. Never changes. Wraps K and the owner identity.
- **Owner identity**: X25519 + ML-KEM-768 + Ed25519 keys, sealed under O inside the keyring. It signs the keyring.
- **Device and person identities**: the same three key pairs, generated on each computer. The private part lives in the system keychain (`safeStorage`); on Linux without a real keychain it is not stored.

```
passphrase --Argon2id--> KEK --wraps--> O
recovery words --------> KEK --wraps--> O
O --wraps--> K (current epoch)
O --wraps--> owner identity
device (owner's) --hybrid KEM--> K and O
person ------------hybrid KEM--> K only
K --wraps--> previous K values (history)
```

## Remote layout

```
format.json      {"format":"sgekb","version":1,"spaceId","suite"} in clear
keyring.json     slots, recipients, history; signed
manifest.json    encrypted list of files; signed
objects/ab/<id>  "SGKB" 0x01 || nonce(24) || ciphertext
pending/<id>.json  access requests (public keys only)
```

### keyring.json

Fields: `spaceId`, `rev` (increases on every change), `epoch` and `keyId` of K, `ownerSignPk`, the owner slots (`passphrase` with its Argon2id parameters, `recovery`, `key` = K under O, `identity` = owner identity under O), `recipients` (public keys, `kind` device or member, `role` admin, writer or reader, `key` = K wrapped with the hybrid KEM, and for the owner's devices `owner` = O wrapped), `history` (earlier K values under the current K), `signer` and `sig`.

The signature covers the canonical JSON (keys sorted) of everything except `signer` and `sig`. Only the owner identity and admin recipients may sign. A device accepts a keyring only if it is signed by a key it already trusts; trust starts with the owner identity (proven by opening O) or with a confirmed pairing code, and moves to the admins listed in each keyring it verifies. A keyring with a lower epoch than the one already seen is rejected, so an old keyring with a removed person cannot come back.

### manifest.json

The body, encrypted with the manifest subkey of its epoch:

```json
{ "spaceId", "seq", "prev", "epoch", "at",
  "entries": { "<path>": { "id", "size", "hash", "v", "e" } } }
```

`hash` is the SHA-256 of the plain file, `v` its version (it increases on every write), `e` the epoch of the key that encrypted it. The file is `{format, version, epoch, signer, nonce, ct, sig}`, signed by the writer's Ed25519 key over the canonical JSON of everything but `sig`. A manifest signed by someone who is not owner, admin or writer is rejected.

Freshness: each device stores the `seq` and BLAKE2b hash of the last manifest it accepted.

| Incoming | Accepted when |
|---|---|
| `seq` lower than the last seen | never (rollback) |
| same `seq` | only if the hash is the same (otherwise a fork) |
| `seq` = last + 1 | only if `prev` is the hash last seen |
| `seq` further ahead | yes, it is signed by a writer |

A missing manifest on a remote this device already synced is also a rollback.

### Objects

Associated data `sgekb:<space>:object:<id>:<v>:<e>`. Because the version and the id are bound, swapping two objects or serving an older object for a path fails authentication. After decrypting, the SHA-256 of the content must match the manifest entry.

## Operations

- **Enable**: generate O, K, owner identity, salt and recovery entropy; the space is encrypted only after three random recovery words are typed back. The first sync writes `format.json`, `keyring.json`, the objects and the manifest, and refuses a destination that already holds plain files.
- **Unlock** with the passphrase or the recovery code (gives O, so full owner rights) or silently with the device key (gives K, and O for the owner's devices).
- **Pairing**: the new device writes its public identity to `pending/`. An owner device shows `pairingCode(ownerSignPk, requester)` as six BIP39 words; the new device later shows the same code computed from the signer of the keyring it receives. Matching codes mean neither side talked to keys inserted by the server.
- **Remove access**: drop the recipient, create a new K (epoch + 1), keep the old K in `history` under the new one, wrap the new K for the owner and every remaining recipient, and encrypt every object again on the next sync.
- **Change passphrase / new recovery code**: re-wrap O. K and the objects do not change.

## Limits

- Content the removed person already downloaded, and old encrypted objects still present in git history, remain readable to them. Purging that history means rewriting the remote, which the app never does on its own.
- Ed25519 signatures are not post-quantum. Forging one needs a quantum computer at the time of the attack, not later, so it does not share the harvest-now risk of encryption.
- This design has not had an external review. Do that before trusting it with data whose exposure would be serious.
