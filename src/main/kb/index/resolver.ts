import { basenameNoExt, extensionOf, isNotePath } from '../../../shared/kb/wikilink'

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

function depth(path: string): number {
  return path.split('/').length
}

export class LinkResolver {
  private byPath = new Map<string, string>()
  private byName = new Map<string, string[]>()

  constructor(paths: Iterable<string> = []) {
    for (const p of paths) this.add(p)
  }

  add(path: string): void {
    this.byPath.set(path.toLowerCase(), path)
    const key = this.nameKey(path)
    const list = this.byName.get(key) ?? []
    if (!list.includes(path)) list.push(path)
    this.byName.set(key, list)
  }

  remove(path: string): void {
    this.byPath.delete(path.toLowerCase())
    const key = this.nameKey(path)
    const list = (this.byName.get(key) ?? []).filter((p) => p !== path)
    if (list.length > 0) this.byName.set(key, list)
    else this.byName.delete(key)
  }

  private nameKey(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return (isNotePath(name) ? basenameNoExt(name) : name).toLowerCase()
  }

  resolve(target: string, fromPath: string): string | null {
    const clean = target.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!clean) return fromPath
    const candidates = extensionOf(clean) ? [clean] : [`${clean}.md`, clean]

    const fromDir = dirOf(fromPath)
    for (const candidate of candidates) {
      if (fromDir) {
        const relative = this.normalizeJoin(fromDir, candidate)
        if (relative) {
          const hit = this.byPath.get(relative.toLowerCase())
          if (hit && (candidate.startsWith('.') || candidate.includes('/'))) return hit
        }
      }
      const exact = this.byPath.get(candidate.toLowerCase())
      if (exact) return exact
    }

    if (clean.includes('/')) {
      const suffixes = candidates.map((c) => `/${c.toLowerCase()}`)
      const matches = [...this.byPath.values()].filter((p) =>
        suffixes.some((s) => `/${p.toLowerCase()}`.endsWith(s))
      )
      return this.pickBest(matches, fromDir)
    }

    const name = clean.slice(clean.lastIndexOf('/') + 1)
    const key = (isNotePath(name) ? basenameNoExt(name) : name).toLowerCase()
    const matches = (this.byName.get(key) ?? []).filter((p) =>
      extensionOf(clean) ? p.toLowerCase().endsWith(clean.toLowerCase()) : true
    )
    const notes = matches.filter((p) => isNotePath(p))
    return this.pickBest(notes.length > 0 ? notes : matches, fromDir)
  }

  private normalizeJoin(dir: string, rel: string): string | null {
    const parts = dir ? dir.split('/') : []
    for (const part of rel.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (parts.length === 0) return null
        parts.pop()
      } else parts.push(part)
    }
    return parts.join('/')
  }

  private pickBest(matches: string[], fromDir: string): string | null {
    if (matches.length === 0) return null
    if (matches.length === 1) return matches[0]
    const sameDir = matches.find((m) => dirOf(m) === fromDir)
    if (sameDir) return sameDir
    return [...matches].sort((a, b) => depth(a) - depth(b) || a.length - b.length || a.localeCompare(b))[0]
  }
}
