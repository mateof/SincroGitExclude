import { kbHandle } from './kb-handlers'
import { rejectRemote } from './kb-sync-handlers'
import { generatePassphrase, passphraseProblem, type KbCryptoService } from '../kb/kb-crypto-service'
import type { RecipientKind, RecipientRole } from '../kb/crypto/keyring'

export function registerKbCryptoHandlers(crypto: KbCryptoService): void {
  kbHandle('kb:crypto-status', (_e, spaceId: string) => crypto.status(spaceId))
  kbHandle('kb:crypto-generate-passphrase', (_e, language?: 'es' | 'en') => {
    const passphrase = generatePassphrase(language === 'en' ? 'en' : 'es')
    return { passphrase, problem: passphraseProblem(passphrase) }
  })
  kbHandle('kb:crypto-check-passphrase', (_e, passphrase: string) => ({ problem: passphraseProblem(passphrase ?? '') }))
  kbHandle('kb:crypto-prepare', (e, spaceId: string, passphrase: string, rememberDevice: boolean) => {
    rejectRemote(e, 'Encrypting a space')
    return crypto.prepareEnable(spaceId, passphrase, rememberDevice !== false)
  })
  kbHandle('kb:crypto-confirm', (e, spaceId: string, answers: Record<number, string>) => {
    rejectRemote(e, 'Encrypting a space')
    return crypto.confirmEnable(spaceId, answers ?? {})
  })
  kbHandle('kb:crypto-adopt', (e, spaceId: string) => {
    rejectRemote(e, 'Opening an encrypted space')
    return crypto.adoptExisting(spaceId)
  })
  kbHandle('kb:crypto-unlock', (e, spaceId: string, secret: { passphrase?: string; recovery?: string }) => {
    rejectRemote(e, 'Unlocking an encrypted space')
    if (secret?.passphrase) return crypto.unlockPassphrase(spaceId, secret.passphrase)
    if (secret?.recovery) return crypto.unlockRecovery(spaceId, secret.recovery)
    throw new Error('Enter the passphrase or the recovery code')
  })
  kbHandle('kb:crypto-lock', (e, spaceId: string) => {
    rejectRemote(e, 'Locking an encrypted space')
    return crypto.lock(spaceId)
  })
  kbHandle('kb:crypto-remember-device', (e, spaceId: string) => {
    rejectRemote(e, 'Giving this device access')
    return crypto.rememberDevice(spaceId)
  })
  kbHandle('kb:crypto-remove-recipient', (e, spaceId: string, recipientId: string) => {
    rejectRemote(e, 'Removing access to an encrypted space')
    return crypto.removeRecipient(spaceId, recipientId)
  })
  kbHandle('kb:crypto-change-passphrase', (e, spaceId: string, passphrase: string) => {
    rejectRemote(e, 'Changing the passphrase')
    return crypto.changePassphrase(spaceId, passphrase)
  })
  kbHandle('kb:crypto-reset-recovery', (e, spaceId: string) => {
    rejectRemote(e, 'Creating a new recovery code')
    return crypto.resetRecovery(spaceId)
  })
  kbHandle('kb:crypto-request-access', (e, spaceId: string) => {
    rejectRemote(e, 'Requesting access to an encrypted space')
    return crypto.requestAccess(spaceId)
  })
  kbHandle('kb:crypto-approve', (e, spaceId: string, requestId: string, kind: RecipientKind, role: RecipientRole) => {
    rejectRemote(e, 'Granting access to an encrypted space')
    return crypto.approve(spaceId, requestId, kind === 'member' ? 'member' : 'device', role === 'reader' ? 'reader' : role === 'admin' ? 'admin' : 'writer')
  })
  kbHandle('kb:crypto-reject', (e, spaceId: string, requestId: string) => {
    rejectRemote(e, 'Rejecting an access request')
    return crypto.reject(spaceId, requestId)
  })
  kbHandle('kb:crypto-pairing-check', (e, spaceId: string) => {
    rejectRemote(e, 'Checking a pairing code')
    return crypto.pairingCheck(spaceId)
  })
  kbHandle('kb:crypto-confirm-pairing', (e, spaceId: string) => {
    rejectRemote(e, 'Confirming a pairing code')
    return crypto.confirmPairing(spaceId)
  })
}
