import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export type McpScope = 'sge:read' | 'sge:write' | 'kb:read' | 'kb:write' | 'kb:admin'

export const ALL_SCOPES: McpScope[] = ['sge:read', 'sge:write', 'kb:read', 'kb:write', 'kb:admin']

export interface McpToken {
  id: string
  name: string
  token: string
  scopes: McpScope[]
  spaces: string[] | null
  createdAt: string
}

export interface McpGrant {
  tokenId: string
  name: string
  scopes: Set<McpScope>
  spaces: string[] | null
}

export const PRIMARY_TOKEN_ID = 'primary'

export function generateToken(): string {
  return `sge_${randomBytes(24).toString('base64url')}`
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected))
}

export function bearerOf(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null
  const value = header.slice(7).trim()
  return value.length > 0 ? value : null
}

export function fullGrant(name = 'primary'): McpGrant {
  return { tokenId: PRIMARY_TOKEN_ID, name, scopes: new Set(ALL_SCOPES), spaces: null }
}

export function resolveGrant(
  header: string | undefined,
  primaryToken: string,
  tokens: McpToken[]
): McpGrant | null {
  const presented = bearerOf(header)
  if (!presented) return null
  let found: McpGrant | null = null
  if (tokenMatches(presented, primaryToken)) found = fullGrant()
  for (const token of tokens) {
    if (tokenMatches(presented, token.token) && !found) {
      found = {
        tokenId: token.id,
        name: token.name,
        scopes: new Set(token.scopes),
        spaces: token.spaces
      }
    }
  }
  return found
}

export function normalizeTokens(raw: unknown): McpToken[] {
  if (!Array.isArray(raw)) return []
  const out: McpToken[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const t = item as Partial<McpToken>
    if (typeof t.id !== 'string' || typeof t.token !== 'string' || t.token.length < 16) continue
    const scopes = Array.isArray(t.scopes) ? t.scopes.filter((s) => ALL_SCOPES.includes(s as McpScope)) : []
    if (scopes.length === 0) continue
    out.push({
      id: t.id,
      name: typeof t.name === 'string' ? t.name : t.id,
      token: t.token,
      scopes: scopes as McpScope[],
      spaces: Array.isArray(t.spaces) && t.spaces.every((s) => typeof s === 'string') ? t.spaces : null,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString()
    })
  }
  return out
}

export function canAccessSpace(grant: McpGrant, spaceId: string): boolean {
  return grant.spaces === null || grant.spaces.includes(spaceId)
}

export function canAdminSpaces(grant: McpGrant): boolean {
  return grant.scopes.has('kb:admin')
}
