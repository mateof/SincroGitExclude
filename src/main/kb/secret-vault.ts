import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_DATA_DIR } from '../app-paths'

const VAULT_PATH = join(DEFAULT_DATA_DIR, 'kb-secrets.json')

type VaultFile = Record<string, string>

function readVault(): VaultFile {
  if (!existsSync(VAULT_PATH)) return {}
  try {
    return JSON.parse(readFileSync(VAULT_PATH, 'utf-8')) as VaultFile
  } catch {
    return {}
  }
}

function writeVault(data: VaultFile): void {
  writeFileSync(VAULT_PATH, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

export function osKeychainUsable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === 'linux') {
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.()
    if (backend === 'basic_text' || backend === 'unknown') return false
  }
  return true
}

export function setSecret(key: string, value: Buffer): void {
  if (!osKeychainUsable()) throw new Error('This system has no usable keychain, so the secret cannot be stored on this device.')
  const vault = readVault()
  vault[key] = safeStorage.encryptString(value.toString('base64')).toString('base64')
  writeVault(vault)
}

export function getSecret(key: string): Buffer | null {
  const vault = readVault()
  const sealed = vault[key]
  if (!sealed || !osKeychainUsable()) return null
  try {
    return Buffer.from(safeStorage.decryptString(Buffer.from(sealed, 'base64')), 'base64')
  } catch {
    return null
  }
}

export function secretKeys(): string[] {
  return Object.keys(readVault())
}

export function hasSecret(key: string): boolean {
  return key in readVault()
}

export function deleteSecret(key: string): void {
  const vault = readVault()
  if (!(key in vault)) return
  delete vault[key]
  writeVault(vault)
}
