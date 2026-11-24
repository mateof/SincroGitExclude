import { deleteSecret, getSecret, secretKeys, setSecret } from './secret-vault'
import { canSendToken, parseRemote } from '../../shared/kb/git-remote'
import type { GitCredential } from './sync/git-auth'

const cache = new Map<string, GitCredential>()

const prefixOf = (spaceId: string): string => `git:${spaceId}:`

function keyOf(spaceId: string, remoteUrl: string): string | null {
  try {
    const { origin } = parseRemote(remoteUrl)
    return origin ? `${prefixOf(spaceId)}${origin}` : null
  } catch {
    return null
  }
}

export function setGitCredential(spaceId: string, remoteUrl: string, credential: GitCredential): void {
  const key = keyOf(spaceId, remoteUrl)
  if (!key) throw new Error('A token only works with an http or https remote')
  if (!canSendToken(parseRemote(remoteUrl))) throw new Error('The token would travel unencrypted over the internet. Use an https remote.')
  if (!credential.token || /[\r\n\0]/.test(credential.username + credential.token)) throw new Error('The token is not valid')
  clearGitCredentials(spaceId)
  setSecret(key, Buffer.from(JSON.stringify(credential), 'utf-8'))
  cache.set(key, credential)
}

export function hasGitCredential(spaceId: string, remoteUrl: string): boolean {
  const key = keyOf(spaceId, remoteUrl)
  return key !== null && secretKeys().includes(key)
}

export function getGitCredential(spaceId: string, remoteUrl: string): GitCredential | null {
  const key = keyOf(spaceId, remoteUrl)
  if (!key) return null
  const cached = cache.get(key)
  if (cached) return cached
  const stored = getSecret(key)
  if (!stored) return null
  const credential = JSON.parse(stored.toString('utf-8')) as GitCredential
  cache.set(key, credential)
  return credential
}

export function clearGitCredentials(spaceId: string): void {
  for (const key of secretKeys().filter((k) => k.startsWith(prefixOf(spaceId)))) {
    deleteSecret(key)
    cache.delete(key)
  }
}
