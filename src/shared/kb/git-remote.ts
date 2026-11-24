export type GitAuthMode = 'system' | 'token' | 'gh' | 'ssh-key'
export type GitProvider = 'github' | 'gitlab' | 'gitea' | 'other'

export const GIT_AUTH_MODES: GitAuthMode[] = ['system', 'token', 'gh', 'ssh-key']

export interface RemoteInfo {
  kind: 'http' | 'ssh' | 'local'
  origin: string | null
  host: string | null
  encrypted: boolean
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[::1\]|[^.]+\.(local|lan|home|internal)|[a-z0-9-]+)$/i

export function parseRemote(raw: string): RemoteInfo {
  const url = raw.trim()
  if (!url) throw new Error('Set the git remote of the space first')
  if (url.startsWith('-') || [...url].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw new Error('The git remote is not valid')
  }
  if (/^[a-z0-9+.-]+::/i.test(url)) throw new Error('This kind of git remote is not allowed')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const parsed = parseUrl(url)
    if (parsed.protocol === 'file:') return { kind: 'local', origin: null, host: null, encrypted: true }
    if (!['http:', 'https:', 'ssh:'].includes(parsed.protocol) || !parsed.hostname || parsed.hostname.startsWith('-')) {
      throw new Error('Use an https, http or ssh git remote')
    }
    if (parsed.password) throw new Error('Do not write the token inside the URL: use the token field')
    if (parsed.protocol === 'ssh:') return { kind: 'ssh', origin: null, host: parsed.hostname, encrypted: true }
    return { kind: 'http', origin: `${parsed.protocol}//${parsed.host}`, host: parsed.hostname, encrypted: parsed.protocol === 'https:' }
  }
  const scp = /^(?:[A-Za-z0-9_.-]+@)?([A-Za-z0-9][A-Za-z0-9.-]+):(?!\\)/.exec(url)
  if (scp) return { kind: 'ssh', origin: null, host: scp[1], encrypted: true }
  return { kind: 'local', origin: null, host: null, encrypted: true }
}

function parseUrl(url: string): URL {
  try {
    return new URL(url)
  } catch {
    throw new Error('The git remote is not valid')
  }
}

export function canSendToken(info: RemoteInfo): boolean {
  return info.kind === 'http' && (info.encrypted || PRIVATE_HOST.test(info.host ?? ''))
}

export function detectProvider(host: string | null): GitProvider {
  const name = (host ?? '').toLowerCase()
  if (name === 'github.com' || name.startsWith('github.')) return 'github'
  if (name.includes('gitlab')) return 'gitlab'
  if (name.includes('gitea') || name.includes('forgejo') || name === 'codeberg.org') return 'gitea'
  return 'other'
}

export function tokenPageUrl(provider: GitProvider, origin: string | null): string | null {
  if (!origin) return null
  if (provider === 'github') return `${origin}/settings/personal-access-tokens/new`
  if (provider === 'gitlab') return `${origin}/-/user_settings/personal_access_tokens`
  if (provider === 'gitea') return `${origin}/user/settings/applications`
  return null
}

export function defaultUsername(provider: GitProvider): string {
  if (provider === 'gitlab') return 'oauth2'
  if (provider === 'github') return 'x-access-token'
  return ''
}
