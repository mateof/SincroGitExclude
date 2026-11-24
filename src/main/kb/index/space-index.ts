import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import MiniSearch from 'minisearch'
import { foldText, isNotePath } from '../../../shared/kb/wikilink'
import { parseNote, type ParsedChunk, type ParsedHeading, type ParsedLink } from '../parse/markdown'
import { LinkResolver } from './resolver'
import { isHiddenSegment, resolveInSpace } from '../paths'

export interface FileEntry {
  path: string
  size: number
  mtimeMs: number
  isNote: boolean
}

export interface NoteEntry extends FileEntry {
  title: string
  tags: string[]
  headings: ParsedHeading[]
  links: ParsedLink[]
  frontmatter: Record<string, unknown>
  frontmatterError: string | null
  hash: string
  chunks: ParsedChunk[]
  text: string
}

export interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'note' | 'file'
  title?: string
  children?: TreeNode[]
  noteCount?: number
}

export interface SearchHit {
  path: string
  title: string
  score: number
  snippet: string
  tags: string[]
}

export interface SearchFilter {
  folder?: string
  tags?: string[]
  limit?: number
}

export interface ResolvedLink extends ParsedLink {
  resolved: string | null
}

const STOPWORDS = new Set(
  (
    'a al algo como con de del el en es esa ese eso esta este esto ha la las le lo los mas me mi muy no o para pero por que se si sin sobre su sus te tu un una uno unos y ya ' +
    'an and are as at be by for from how i if in into is it of on or so that the this to was what when where which who why will with'
  ).split(' ')
)

export function hashContent(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex')
}

function folderMatches(path: string, folder: string | undefined): boolean {
  if (!folder) return true
  const clean = folder.replace(/^\/+|\/+$/g, '')
  return clean === '' || path === clean || path.startsWith(`${clean}/`)
}

function snippetFor(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const folded = foldText(flat)
  let at = -1
  for (const term of terms) {
    const idx = folded.indexOf(foldText(term))
    if (idx >= 0 && (at < 0 || idx < at)) at = idx
  }
  if (at < 0) return flat.slice(0, 180) + (flat.length > 180 ? '…' : '')
  const start = Math.max(0, at - 70)
  const end = Math.min(flat.length, at + 130)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

export class SpaceIndex {
  readonly files = new Map<string, FileEntry>()
  readonly notes = new Map<string, NoteEntry>()
  private resolver = new LinkResolver()
  private search$: MiniSearch<{ id: string; title: string; headings: string; tags: string; text: string; path: string }>
  private backlinkCache: Map<string, Array<{ from: string; line: number }>> | null = null
  private excluded: string[]

  constructor(
    readonly root: string,
    options: { excludeDirs?: string[] } = {}
  ) {
    this.excluded = (options.excludeDirs ?? []).map((d) => d.replace(/^\/+|\/+$/g, '')).filter(Boolean)
    this.search$ = this.createSearch()
  }

  private createSearch(): SpaceIndex['search$'] {
    return new MiniSearch({
      fields: ['title', 'headings', 'tags', 'text', 'path'],
      storeFields: ['title', 'path'],
      processTerm: (term) => {
        const folded = foldText(term)
        return folded.length > 0 && !STOPWORDS.has(folded) ? folded : null
      },
      searchOptions: {
        boost: { title: 4, headings: 2, tags: 2.5, path: 1.5 },
        prefix: true,
        fuzzy: 0.15,
        combineWith: 'AND'
      }
    })
  }

  setExcludedDirs(dirs: string[]): void {
    this.excluded = dirs.map((d) => d.replace(/^\/+|\/+$/g, '')).filter(Boolean)
  }

  isIndexable(rel: string): boolean {
    if (!rel || isHiddenSegment(rel)) return false
    return !this.excluded.some((d) => rel === d || rel.startsWith(`${d}/`))
  }

  async build(): Promise<void> {
    this.files.clear()
    this.notes.clear()
    this.resolver = new LinkResolver()
    this.search$ = this.createSearch()
    this.backlinkCache = null
    await this.scan('')
  }

  private async scan(rel: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(rel ? join(this.root, rel) : this.root, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (!this.isIndexable(child)) continue
      if (entry.isDirectory()) await this.scan(child)
      else if (entry.isFile()) await this.updateFile(child)
    }
  }

  async updateFile(rel: string): Promise<'added' | 'changed' | 'removed' | 'unchanged' | 'skipped'> {
    if (!this.isIndexable(rel)) return 'skipped'
    const full = resolveInSpace(this.root, rel)
    let stat: import('fs').Stats
    try {
      stat = await fs.stat(full)
    } catch {
      return this.removeFile(rel) ? 'removed' : 'unchanged'
    }
    if (stat.isDirectory()) {
      await this.scan(rel)
      return 'changed'
    }
    const previous = this.files.get(rel)
    const isNote = isNotePath(rel)
    if (!isNote) {
      this.files.set(rel, { path: rel, size: stat.size, mtimeMs: stat.mtimeMs, isNote: false })
      if (!previous) {
        this.resolver.add(rel)
        this.backlinkCache = null
      }
      return previous ? 'changed' : 'added'
    }
    const content = await fs.readFile(full)
    const hash = hashContent(content)
    const prevNote = this.notes.get(rel)
    if (prevNote && prevNote.hash === hash) {
      prevNote.mtimeMs = stat.mtimeMs
      return 'unchanged'
    }
    const parsed = parseNote(content.toString('utf-8'), rel)
    const note: NoteEntry = {
      path: rel,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      isNote: true,
      title: parsed.title,
      tags: parsed.tags,
      headings: parsed.headings,
      links: parsed.links,
      frontmatter: parsed.frontmatter,
      frontmatterError: parsed.frontmatterError,
      hash,
      chunks: parsed.chunks,
      text: parsed.text
    }
    this.files.set(rel, note)
    this.notes.set(rel, note)
    if (!previous) this.resolver.add(rel)
    const doc = {
      id: rel,
      path: rel.replace(/[/_-]/g, ' '),
      title: note.title,
      headings: note.headings.map((h) => h.text).join('\n'),
      tags: note.tags.join(' '),
      text: note.text
    }
    if (this.search$.has(rel)) this.search$.replace(doc)
    else this.search$.add(doc)
    this.backlinkCache = null
    return previous ? 'changed' : 'added'
  }

  removeFile(rel: string): boolean {
    const removedPaths = [...this.files.keys()].filter((p) => p === rel || p.startsWith(`${rel}/`))
    for (const path of removedPaths) {
      this.files.delete(path)
      if (this.notes.delete(path) && this.search$.has(path)) this.search$.discard(path)
      this.resolver.remove(path)
    }
    if (removedPaths.length > 0) this.backlinkCache = null
    return removedPaths.length > 0
  }

  resolve(target: string, fromPath: string): string | null {
    return this.resolver.resolve(target, fromPath)
  }

  outgoing(path: string): ResolvedLink[] {
    const note = this.notes.get(path)
    if (!note) return []
    return note.links.map((link) => ({ ...link, resolved: this.resolve(link.target, path) }))
  }

  backlinks(path: string): Array<{ from: string; line: number; title: string }> {
    if (!this.backlinkCache) {
      const cache = new Map<string, Array<{ from: string; line: number }>>()
      for (const note of this.notes.values()) {
        for (const link of note.links) {
          const target = this.resolve(link.target, note.path)
          if (!target || target === note.path) continue
          const list = cache.get(target) ?? []
          if (!list.some((l) => l.from === note.path)) list.push({ from: note.path, line: link.line })
          cache.set(target, list)
        }
      }
      this.backlinkCache = cache
    }
    return (this.backlinkCache.get(path) ?? []).map((b) => ({
      ...b,
      title: this.notes.get(b.from)?.title ?? b.from
    }))
  }

  unresolvedLinks(): Array<{ from: string; target: string; line: number }> {
    const out: Array<{ from: string; target: string; line: number }> = []
    for (const note of this.notes.values()) {
      for (const link of note.links) {
        if (!this.resolve(link.target, note.path)) out.push({ from: note.path, target: link.target, line: link.line })
      }
    }
    return out
  }

  search(query: string, filter: SearchFilter = {}): SearchHit[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const limit = filter.limit ?? 20
    const wanted = (filter.tags ?? []).map((t) => t.replace(/^#/, '').toLowerCase())
    const accept = (result: { id: unknown }): boolean => {
      const note = this.notes.get(result.id as string)
      if (!note || !folderMatches(note.path, filter.folder)) return false
      if (wanted.length === 0) return true
      const tags = note.tags.map((t) => t.toLowerCase())
      return wanted.every((w) => tags.some((t) => t === w || t.startsWith(`${w}/`)))
    }
    const results = this.search$.search(trimmed, { filter: accept })
    const relaxed =
      results.length > 0 ? results : this.search$.search(trimmed, { combineWith: 'OR', filter: accept })
    return relaxed.slice(0, limit).map((r) => {
      const note = this.notes.get(r.id as string)!
      return {
        path: note.path,
        title: note.title,
        score: r.score,
        snippet: snippetFor(note.text, r.terms),
        tags: note.tags
      }
    })
  }

  recent(limit = 20, folder?: string): NoteEntry[] {
    return [...this.notes.values()]
      .filter((n) => folderMatches(n.path, folder))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
  }

  tags(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>()
    for (const note of this.notes.values()) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  tree(options: { includeFiles?: boolean } = {}): TreeNode {
    const root: TreeNode = { name: '', path: '', type: 'folder', children: [], noteCount: 0 }
    const folders = new Map<string, TreeNode>([['', root]])
    const ensureFolder = (path: string): TreeNode => {
      const existing = folders.get(path)
      if (existing) return existing
      const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const parent = ensureFolder(parentPath)
      const node: TreeNode = {
        name: path.slice(path.lastIndexOf('/') + 1),
        path,
        type: 'folder',
        children: [],
        noteCount: 0
      }
      parent.children!.push(node)
      folders.set(path, node)
      return node
    }
    for (const file of this.files.values()) {
      if (!file.isNote && !options.includeFiles) continue
      const parentPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      const parent = ensureFolder(parentPath)
      const note = file.isNote ? this.notes.get(file.path) : undefined
      parent.children!.push({
        name: file.path.slice(file.path.lastIndexOf('/') + 1),
        path: file.path,
        type: file.isNote ? 'note' : 'file',
        title: note?.title
      })
    }
    const finish = (node: TreeNode): number => {
      if (node.type !== 'folder') return node.type === 'note' ? 1 : 0
      let count = 0
      for (const child of node.children!) count += finish(child)
      node.children!.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1
        if (a.type !== 'folder' && b.type === 'folder') return 1
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })
      node.noteCount = count
      return count
    }
    finish(root)
    return root
  }

  stats(): { notes: number; files: number; tags: number; unresolved: number } {
    return {
      notes: this.notes.size,
      files: this.files.size,
      tags: this.tags().length,
      unresolved: this.unresolvedLinks().length
    }
  }
}
