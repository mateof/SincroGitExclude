import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'
import { parse as parseYaml } from 'yaml'
import type { Root, RootContent } from 'mdast'
import {
  WIKILINK_PATTERN,
  TAG_PATTERN,
  basenameNoExt,
  parseWikiInner
} from '../../../shared/kb/wikilink'

export interface ParsedHeading {
  level: number
  text: string
  line: number
}

export interface ParsedLink {
  target: string
  heading: string | null
  block: string | null
  alias: string | null
  embed: boolean
  line: number
  kind: 'wiki' | 'markdown'
}

export interface ParsedChunk {
  headingPath: string[]
  text: string
  line: number
}

export interface ParsedNote {
  title: string
  frontmatter: Record<string, unknown>
  frontmatterError: string | null
  tags: string[]
  headings: ParsedHeading[]
  links: ParsedLink[]
  chunks: ParsedChunk[]
  text: string
  body: string
  bodyLine: number
}

const MAX_CHUNK = 1800

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml'])

function tagsFromFrontmatter(frontmatter: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['tags', 'tag']) {
    const value = frontmatter[key]
    if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
    } else if (typeof value === 'string') {
      out.push(...value.split(/[,\s]+/))
    }
  }
  return out.map((t) => t.trim().replace(/^#/, '')).filter((t) => t.length > 0)
}

function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#')
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text]
  const parts: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length + 2 > MAX_CHUNK) {
      parts.push(current)
      current = ''
    }
    if (paragraph.length > MAX_CHUNK) {
      for (let i = 0; i < paragraph.length; i += MAX_CHUNK) parts.push(paragraph.slice(i, i + MAX_CHUNK))
      continue
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  if (current) parts.push(current)
  return parts
}

function lineAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++
  return line
}

export function parseNote(content: string, path: string): ParsedNote {
  const tree = processor.parse(content) as Root
  let frontmatter: Record<string, unknown> = {}
  let frontmatterError: string | null = null
  let bodyStart = 0

  const first = tree.children[0]
  if (first && first.type === 'yaml') {
    bodyStart = first.position?.end.offset ?? 0
    try {
      const parsed = parseYaml(first.value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>
      }
    } catch (error) {
      frontmatterError = (error as Error).message
    }
  }

  const headings: ParsedHeading[] = []
  const links: ParsedLink[] = []
  const inlineTags: string[] = []

  visit(tree, (node) => {
    if (node.type === 'heading') {
      headings.push({ level: node.depth, text: toString(node).trim(), line: node.position?.start.line ?? 0 })
    }
    if (node.type === 'text') {
      const line = node.position?.start.line ?? 0
      for (const match of node.value.matchAll(WIKILINK_PATTERN)) {
        const target = parseWikiInner(match[2])
        const offsetLines = node.value.slice(0, match.index).split('\n').length - 1
        links.push({ ...target, embed: match[1] === '!', line: line + offsetLines, kind: 'wiki' })
      }
      for (const match of node.value.matchAll(TAG_PATTERN)) inlineTags.push(match[2])
    }
    if ((node.type === 'link' || node.type === 'image') && typeof node.url === 'string' && !isExternalUrl(node.url)) {
      const raw = decodeSafe(node.url)
      const hash = raw.indexOf('#')
      const target = hash >= 0 ? raw.slice(0, hash) : raw
      if (target) {
        links.push({
          target,
          heading: hash >= 0 ? raw.slice(hash + 1) || null : null,
          block: null,
          alias: null,
          embed: node.type === 'image',
          line: node.position?.start.line ?? 0,
          kind: 'markdown'
        })
      }
    }
  })

  const tags = [...new Set([...tagsFromFrontmatter(frontmatter), ...inlineTags].map((t) => t.replace(/\/+$/, '')))]
    .filter((t) => t.length > 0)
    .sort((a, b) => a.localeCompare(b))

  const fmTitle = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : ''
  const h1 = headings.find((h) => h.level === 1)
  const title = fmTitle || h1?.text || basenameNoExt(path)

  const body = content.slice(bodyStart)
  const chunks = chunkSections(tree.children, content, bodyStart)
  const text = tree.children
    .filter((n) => n.type !== 'yaml')
    .map((n) => blockText(n))
    .join('\n')

  return {
    title,
    frontmatter,
    frontmatterError,
    tags,
    headings,
    links,
    chunks,
    text,
    body,
    bodyLine: lineAt(content, bodyStart)
  }
}

const BLOCK_CONTAINERS = new Set(['list', 'listItem', 'blockquote', 'table', 'tableRow'])

function blockText(node: RootContent): string {
  if (BLOCK_CONTAINERS.has(node.type) && 'children' in node) {
    const separator = node.type === 'tableRow' ? ' ' : '\n'
    return (node.children as RootContent[]).map(blockText).join(separator)
  }
  return toString(node)
}

function chunkSections(children: RootContent[], content: string, bodyStart: number): ParsedChunk[] {
  const boundaries: Array<{ offset: number; depth: number; text: string; line: number }> = []
  for (const node of children) {
    if (node.type === 'heading' && node.position) {
      boundaries.push({
        offset: node.position.start.offset ?? 0,
        depth: node.depth,
        text: toString(node).trim(),
        line: node.position.start.line
      })
    }
  }
  const chunks: ParsedChunk[] = []
  const stack: Array<{ depth: number; text: string }> = []
  const push = (start: number, end: number, line: number): void => {
    const slice = content.slice(start, end).trim()
    if (!slice) return
    for (const part of splitLong(slice)) chunks.push({ headingPath: stack.map((s) => s.text), text: part, line })
  }
  let cursor = bodyStart
  let cursorLine = lineAt(content, bodyStart)
  for (const boundary of boundaries) {
    push(cursor, boundary.offset, cursorLine)
    while (stack.length > 0 && stack[stack.length - 1].depth >= boundary.depth) stack.pop()
    stack.push({ depth: boundary.depth, text: boundary.text })
    cursor = boundary.offset
    cursorLine = boundary.line
  }
  push(cursor, content.length, cursorLine)
  return chunks
}
