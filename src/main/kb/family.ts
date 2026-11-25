import { relative, sep, isAbsolute } from 'path'
import { LinkResolver } from './index/resolver'
import type { SpaceIndex } from './index/space-index'

export interface FamilyMember {
  id: string
  localPath: string
  parentId: string | null
  shared: boolean
  index: SpaceIndex | undefined
}

export interface Located {
  spaceId: string
  path: string
}

export function prefixOf(rootPath: string, memberPath: string): string {
  const rel = relative(rootPath, memberPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return ''
  return rel.split(sep).join('/')
}

export class SpaceFamily {
  private resolver: LinkResolver | null = null
  private backlinkCache: Map<string, Array<{ from: string; line: number }>> | null = null
  readonly rootId: string
  private readonly prefixes = new Map<string, string>()

  constructor(readonly members: FamilyMember[]) {
    const root = members.find((m) => m.parentId === null || !members.some((o) => o.id === m.parentId))!
    this.rootId = root.id
    for (const m of members) this.prefixes.set(m.id, prefixOf(root.localPath, m.localPath))
  }

  invalidate(): void {
    this.resolver = null
    this.backlinkCache = null
  }

  toVault(spaceId: string, path: string): string {
    const prefix = this.prefixes.get(spaceId) ?? ''
    return prefix ? `${prefix}/${path}` : path
  }

  fromVault(vaultPath: string): Located | null {
    let best: { id: string; prefix: string } | null = null
    for (const [id, prefix] of this.prefixes) {
      if (prefix === '' || vaultPath === prefix || vaultPath.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.prefix.length) best = { id, prefix }
      }
    }
    if (!best) return null
    return { spaceId: best.id, path: best.prefix ? vaultPath.slice(best.prefix.length + 1) : vaultPath }
  }

  private ensureResolver(): LinkResolver {
    if (this.resolver) return this.resolver
    const resolver = new LinkResolver()
    for (const m of this.members) {
      if (!m.index) continue
      for (const path of m.index.files.keys()) resolver.add(this.toVault(m.id, path))
    }
    this.resolver = resolver
    return resolver
  }

  resolve(spaceId: string, fromPath: string, target: string): Located | null {
    const hit = this.ensureResolver().resolve(target, this.toVault(spaceId, fromPath))
    return hit ? this.fromVault(hit) : null
  }

  isDescendantOrSelf(candidateId: string, ancestorId: string): boolean {
    let current: string | null = candidateId
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true
      seen.add(current)
      current = this.members.find((m) => m.id === current)?.parentId ?? null
    }
    return false
  }

  crossesToPrivate(fromSpaceId: string, toSpaceId: string): boolean {
    const from = this.members.find((m) => m.id === fromSpaceId)
    if (!from?.shared) return false
    return !this.isDescendantOrSelf(toSpaceId, fromSpaceId)
  }

  backlinks(spaceId: string, path: string): Array<Located & { line: number }> {
    if (!this.backlinkCache) {
      const cache = new Map<string, Array<{ from: string; line: number }>>()
      for (const m of this.members) {
        if (!m.index) continue
        for (const note of m.index.notes.values()) {
          const fromVault = this.toVault(m.id, note.path)
          for (const link of note.links) {
            const target = this.ensureResolver().resolve(link.target, fromVault)
            if (!target || target === fromVault) continue
            const list = cache.get(target) ?? []
            if (!list.some((l) => l.from === fromVault)) list.push({ from: fromVault, line: link.line })
            cache.set(target, list)
          }
        }
      }
      this.backlinkCache = cache
    }
    return (this.backlinkCache.get(this.toVault(spaceId, path)) ?? [])
      .map((b) => {
        const located = this.fromVault(b.from)
        return located ? { ...located, line: b.line } : null
      })
      .filter((b): b is Located & { line: number } => b !== null)
  }

  childDirsOf(spaceId: string): string[] {
    const own = this.prefixes.get(spaceId) ?? ''
    const out: string[] = []
    for (const m of this.members) {
      if (m.id === spaceId) continue
      const prefix = this.prefixes.get(m.id) ?? ''
      if (own === '' && prefix) out.push(prefix)
      else if (prefix.startsWith(`${own}/`)) out.push(prefix.slice(own.length + 1))
    }
    return out
  }
}
