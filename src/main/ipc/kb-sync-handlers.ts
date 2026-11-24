import { kbHandle } from './kb-handlers'
import { isWebEvent } from './channel-registry'
import type { KbService } from '../kb/kb-service'
import type { GitRemoteInput, KbSyncService } from '../kb/kb-sync-service'
import { deleteSecret, setSecret } from '../kb/secret-vault'
import { clearGitCredentials } from '../kb/git-credentials'

export function rejectRemote(event: unknown, what: string): void {
  const transport = (event as { __transport?: string } | null)?.__transport
  if (transport === 'mcp') throw new Error(`${what} stays with the person, not the assistant`)
  if (isWebEvent(event)) throw new Error(`${what} can only be done in the app window, not from a browser`)
}

export function registerKbSyncHandlers(kb: KbService, sync: KbSyncService): void {
  kbHandle('kb:sync', (_e, spaceId: string) => sync.syncNow(spaceId))
  kbHandle('kb:test-backend', (_e, spaceId: string) => sync.testBackend(spaceId))
  kbHandle('kb:test-remote', (e, input: GitRemoteInput) => {
    rejectRemote(e, 'Testing credentials')
    return sync.testRemote(input)
  })
  kbHandle('kb:set-git-token', (e, spaceId: string, token: string | null) => {
    rejectRemote(e, 'Storing a repository token')
    kb.getSpace(spaceId)
    if (token) sync.storeGitToken(spaceId, token)
    else clearGitCredentials(spaceId)
    return kb.getSpace(spaceId)
  })
  kbHandle('kb:trust-host', async (e, spaceId: string, fingerprint: string) => {
    rejectRemote(e, 'Trusting a server key')
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) throw new Error('Invalid fingerprint')
    const space = kb.getSpace(spaceId)
    return kb.updateSpace(spaceId, { backendConfig: { ...space.backendConfig, hostFingerprint: fingerprint } })
  })
  kbHandle('kb:set-sftp-passphrase', (e, spaceId: string, passphrase: string | null) => {
    rejectRemote(e, 'Storing a key passphrase')
    kb.getSpace(spaceId)
    if (passphrase) setSecret(`sftp:${spaceId}`, Buffer.from(passphrase, 'utf-8'))
    else deleteSecret(`sftp:${spaceId}`)
    return { stored: Boolean(passphrase) }
  })
  kbHandle('kb:history', (_e, spaceId: string, path: string) => sync.history(spaceId, path))
  kbHandle('kb:note-at', (_e, spaceId: string, path: string, commit: string) => sync.noteAt(spaceId, path, commit))
  kbHandle('kb:note-diff', (_e, spaceId: string, path: string, commit: string) => sync.noteDiff(spaceId, path, commit))
  kbHandle('kb:clone-space', (e, input: GitRemoteInput & { targetPath: string; name?: string }) => {
    rejectRemote(e, 'Cloning a space into a folder of this computer')
    return sync.cloneAndAdd(input)
  })
  kbHandle('kb:reset-sync-state', (e, spaceId: string) => {
    rejectRemote(e, 'Resetting the sync state')
    sync.resetState(spaceId)
    return { reset: spaceId }
  })
}
