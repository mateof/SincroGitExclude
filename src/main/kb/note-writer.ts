import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { parseDocument } from 'yaml'
import { foldText, isNotePath } from '../../shared/kb/wikilink'
import { hashContent } from './index/space-index'
import { normalizeRel, resolveInSpace } from './paths'

export class NoteConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoteConflictError'
  }
}

export interface WriteResult {
  path: string
  hashBefore: string | null
  hashAfter: string | null
  before: Buffer | null
}

export async function atomicWrite(full: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(dirname(full), { recursive: true })
  const tmp = join(dirname(full), `.${randomBytes(6).toString('hex')}.sge-tmp`)
  await fs.writeFile(tmp, data)
  try {
    await fs.rename(tmp, full)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
}

async function readIfExists(full: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(full)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function requireNotePath(rel: string): string {
  const clean = normalizeRel(rel)
  if (!clean) throw new Error('A note path is required')
  if (clean.split('/').some((p) => p.startsWith('.'))) throw new Error(`Hidden folders are not notes: ${rel}`)
  return isNotePath(clean) ? clean : `${clean}.md`
}

function checkHash(current: Buffer | null, expectedHash: string | undefined, rel: string): void {
  if (current === null) throw new NoteConflictError(`Note not found: ${rel}`)
  if (expectedHash === undefined) {
    throw new NoteConflictError(`expectedHash is required to change ${rel}. Read the note first and pass its hash.`)
  }
  const actual = hashContent(current)
  if (actual !== expectedHash) {
    throw new NoteConflictError(
      `${rel} changed since it was read (hash ${actual.slice(0, 12)}…). Read it again and retry.`
    )
  }
}

export async function createNote(root: string, rel: string, content: string): Promise<WriteResult> {
  const path = requireNotePath(rel)
  const full = resolveInSpace(root, path)
  if ((await readIfExists(full)) !== null) throw new NoteConflictError(`The note already exists: ${path}`)
  await atomicWrite(full, content)
  return { path, hashBefore: null, hashAfter: hashContent(content), before: null }
}

export async function replaceInNote(
  root: string,
  rel: string,
  oldText: string,
  newText: string,
  expectedHash: string | undefined
): Promise<WriteResult> {
  const path = requireNotePath(rel)
  const full = resolveInSpace(root, path)
  const current = await readIfExists(full)
  checkHash(current, expectedHash, path)
  const text = current!.toString('utf-8')
  if (!oldText) throw new Error('oldText cannot be empty')
  const first = text.indexOf(oldText)
  if (first < 0) throw new NoteConflictError(`oldText was not found in ${path}`)
  if (text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new NoteConflictError(`oldText appears more than once in ${path}. Include more context to make it unique.`)
  }
  const next = text.slice(0, first) + newText + text.slice(first + oldText.length)
  await atomicWrite(full, next)
  return { path, hashBefore: hashContent(current!), hashAfter: hashContent(next), before: current }
}

export async function appendToNote(
  root: string,
  rel: string,
  addition: string,
  expectedHash: string | undefined
): Promise<WriteResult> {
  const path = requireNotePath(rel)
  const full = resolveInSpace(root, path)
  const current = await readIfExists(full)
  checkHash(current, expectedHash, path)
  const text = current!.toString('utf-8')
  const separator = text.length === 0 || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  const next = text + separator + addition + (addition.endsWith('\n') ? '' : '\n')
  await atomicWrite(full, next)
  return { path, hashBefore: hashContent(current!), hashAfter: hashContent(next), before: current }
}

interface Section {
  headingLine: number
  bodyStart: number
  bodyEnd: number
}

function findSection(lines: string[], heading: string): Section | null {
  const wanted = foldText(heading.replace(/^#+\s*/, '').trim())
  let inFence = false
  let found: { line: number; level: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const match = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (!match) continue
    const level = match[1].length
    if (found) {
      if (level <= found.level) return { headingLine: found.line, bodyStart: found.line + 1, bodyEnd: i }
      continue
    }
    if (foldText(match[2]) === wanted) found = { line: i, level }
  }
  return found ? { headingLine: found.line, bodyStart: found.line + 1, bodyEnd: lines.length } : null
}

export function extractSection(text: string, heading: string): string | null {
  const lines = text.split(/\r?\n/)
  const section = findSection(lines, heading)
  if (!section) return null
  return lines.slice(section.headingLine, section.bodyEnd).join('\n').trimEnd()
}

export async function patchSection(
  root: string,
  rel: string,
  heading: string,
  content: string,
  mode: 'replace' | 'append' | 'prepend',
  expectedHash: string | undefined
): Promise<WriteResult> {
  const path = requireNotePath(rel)
  const full = resolveInSpace(root, path)
  const current = await readIfExists(full)
  checkHash(current, expectedHash, path)
  const text = current!.toString('utf-8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const section = findSection(lines, heading)
  if (!section) throw new NoteConflictError(`Heading not found in ${path}: ${heading}`)
  const body = lines.slice(section.bodyStart, section.bodyEnd)
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
  while (body.length > 0 && body[0].trim() === '') body.shift()
  const incoming = content.replace(/\r?\n$/, '').split(/\r?\n/)
  let nextBody: string[]
  if (mode === 'replace') nextBody = incoming
  else if (mode === 'append') nextBody = body.length > 0 ? [...body, '', ...incoming] : incoming
  else nextBody = body.length > 0 ? [...incoming, '', ...body] : incoming
  const after = lines.slice(section.bodyEnd)
  const rebuilt = [
    ...lines.slice(0, section.bodyStart),
    '',
    ...nextBody,
    ...(after.length > 0 ? ['', ...after] : [''])
  ]
  const next = rebuilt.join(eol)
  await atomicWrite(full, next)
  return { path, hashBefore: hashContent(current!), hashAfter: hashContent(next), before: current }
}

export function applyFrontmatter(text: string, patch: Record<string, unknown>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const doc = parseDocument(match ? match[1] : '')
  if (doc.errors.length > 0) throw new Error(`The frontmatter is not valid YAML: ${doc.errors[0].message}`)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) doc.delete(key)
    else doc.set(key, value)
  }
  const yamlText = doc.contents && String(doc).trim() !== '{}' && String(doc).trim() !== '' ? String(doc).trimEnd() : ''
  const body = match ? text.slice(match[0].length) : text
  if (!yamlText) return body.replace(/^\r?\n/, '')
  const normalized = yamlText.replace(/\n/g, eol)
  return `---${eol}${normalized}${eol}---${eol}${match ? body : eol + body}`
}

export async function setFrontmatter(
  root: string,
  rel: string,
  patch: Record<string, unknown>,
  expectedHash: string | undefined
): Promise<WriteResult> {
  const path = requireNotePath(rel)
  const full = resolveInSpace(root, path)
  const current = await readIfExists(full)
  checkHash(current, expectedHash, path)
  const next = applyFrontmatter(current!.toString('utf-8'), patch)
  await atomicWrite(full, next)
  return { path, hashBefore: hashContent(current!), hashAfter: hashContent(next), before: current }
}

export async function trashNote(root: string, rel: string, expectedHash: string | undefined): Promise<WriteResult & { trashPath: string }> {
  const path = requireNotePath(rel)
  const full = resolveInSpace(root, path)
  const current = await readIfExists(full)
  checkHash(current, expectedHash, path)
  let trashRel = `.trash/${path}`
  let n = 1
  while ((await readIfExists(join(root, ...trashRel.split('/')))) !== null) {
    trashRel = `.trash/${path.replace(/\.md$/, '')} ${n++}.md`
  }
  const trashFull = join(root, ...trashRel.split('/'))
  await fs.mkdir(dirname(trashFull), { recursive: true })
  await fs.rename(full, trashFull)
  return { path, hashBefore: hashContent(current!), hashAfter: null, before: current, trashPath: trashRel }
}

export async function restoreContent(root: string, rel: string, content: Buffer | null): Promise<void> {
  const full = resolveInSpace(root, normalizeRel(rel))
  if (content === null) await fs.rm(full, { force: true })
  else await atomicWrite(full, content)
}
