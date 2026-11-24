import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  appendToNote,
  applyFrontmatter,
  createNote,
  NoteConflictError,
  patchSection,
  replaceInNote,
  setFrontmatter,
  trashNote
} from '../src/main/kb/note-writer'
import { hashContent } from '../src/main/kb/index/space-index'

let root: string
const read = (rel: string): string => readFileSync(join(root, rel), 'utf-8')
const hashOf = (rel: string): string => hashContent(readFileSync(join(root, rel)))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sge-kbw-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('note writer', () => {
  it('creates a note and adds the .md extension, refusing to overwrite', async () => {
    const result = await createNote(root, 'inbox/idea', '# Idea\n')
    expect(result.path).toBe('inbox/idea.md')
    expect(read('inbox/idea.md')).toBe('# Idea\n')
    await expect(createNote(root, 'inbox/idea.md', 'x')).rejects.toBeInstanceOf(NoteConflictError)
  })

  it('refuses writes into hidden folders such as .obsidian', async () => {
    await expect(createNote(root, '.obsidian/app', '{}')).rejects.toThrow(/Hidden folders/)
  })

  it('requires the hash the caller read so a concurrent edit is never overwritten', async () => {
    await createNote(root, 'a.md', 'uno dos tres\n')
    await expect(replaceInNote(root, 'a.md', 'dos', '2', undefined)).rejects.toThrow(/expectedHash is required/)
    const stale = hashOf('a.md')
    writeFileSync(join(root, 'a.md'), 'uno dos tres cuatro\n')
    await expect(replaceInNote(root, 'a.md', 'dos', '2', stale)).rejects.toThrow(/changed since it was read/)
    await replaceInNote(root, 'a.md', 'dos', '2', hashOf('a.md'))
    expect(read('a.md')).toBe('uno 2 tres cuatro\n')
  })

  it('refuses an ambiguous replacement', async () => {
    await createNote(root, 'a.md', 'x y x\n')
    await expect(replaceInNote(root, 'a.md', 'x', 'z', hashOf('a.md'))).rejects.toThrow(/more than once/)
  })

  it('appends with a blank line between blocks', async () => {
    await createNote(root, 'a.md', '# A\n\nfirst')
    await appendToNote(root, 'a.md', 'second', hashOf('a.md'))
    expect(read('a.md')).toBe('# A\n\nfirst\n\nsecond\n')
  })

  it('replaces only the body of the matching section, ignoring headings in code fences', async () => {
    await createNote(
      root,
      'a.md',
      '# Title\n\nintro\n\n## Estado\n\nviejo\n\n```\n## Estado\n```\n\n### Sub\n\nsub body\n\n## Siguiente\n\nresto\n'
    )
    await patchSection(root, 'a.md', 'estado', 'nuevo', 'replace', hashOf('a.md'))
    expect(read('a.md')).toBe('# Title\n\nintro\n\n## Estado\n\nnuevo\n\n## Siguiente\n\nresto\n')
  })

  it('appends to a section that runs to the end of the file', async () => {
    await createNote(root, 'a.md', '# T\n\n## Log\n\n- uno\n')
    await patchSection(root, 'a.md', 'Log', '- dos', 'append', hashOf('a.md'))
    expect(read('a.md')).toBe('# T\n\n## Log\n\n- uno\n\n- dos\n')
  })

  it('edits frontmatter keys, removes keys set to null and keeps the body', () => {
    const text = '---\ntags: [a]\nstatus: draft\n---\n\n# Body\n'
    expect(applyFrontmatter(text, { status: 'done', date: '2026-11-23', tags: null })).toBe(
      '---\nstatus: done\ndate: 2026-11-23\n---\n\n# Body\n'
    )
    expect(applyFrontmatter('# Body\n', { status: 'new' })).toBe('---\nstatus: new\n---\n\n# Body\n')
  })

  it('writes frontmatter through the hash check', async () => {
    await createNote(root, 'a.md', '# Body\n')
    await setFrontmatter(root, 'a.md', { status: 'activo' }, hashOf('a.md'))
    expect(read('a.md')).toBe('---\nstatus: activo\n---\n\n# Body\n')
  })

  it('moves deleted notes to .trash like Obsidian and never collides', async () => {
    mkdirSync(join(root, '.trash', 'inbox'), { recursive: true })
    writeFileSync(join(root, '.trash', 'inbox', 'x.md'), 'older')
    await createNote(root, 'inbox/x.md', 'bye\n')
    const result = await trashNote(root, 'inbox/x.md', hashOf('inbox/x.md'))
    expect(result.trashPath).toBe('.trash/inbox/x 1.md')
    expect(existsSync(join(root, 'inbox', 'x.md'))).toBe(false)
    expect(read('.trash/inbox/x 1.md')).toBe('bye\n')
  })
})
