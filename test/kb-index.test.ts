import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { parseNote } from '../src/main/kb/parse/markdown'
import { LinkResolver } from '../src/main/kb/index/resolver'
import { SpaceIndex } from '../src/main/kb/index/space-index'
import { parseWikiInner, foldText } from '../src/shared/kb/wikilink'
import { resolveInSpace, PathOutsideSpaceError } from '../src/main/kb/paths'

let root: string

function put(rel: string, content: string): void {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sge-kb-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('parseWikiInner', () => {
  it('splits target, heading, block and alias the way Obsidian does', () => {
    expect(parseWikiInner('note')).toEqual({ target: 'note', heading: null, block: null, alias: null })
    expect(parseWikiInner('folder/note#Section|Shown')).toEqual({
      target: 'folder/note',
      heading: 'Section',
      block: null,
      alias: 'Shown'
    })
    expect(parseWikiInner('note#^abc123')).toEqual({ target: 'note', heading: null, block: 'abc123', alias: null })
    expect(parseWikiInner('#Local heading')).toEqual({ target: '', heading: 'Local heading', block: null, alias: null })
    expect(parseWikiInner('note\\|alias in table')).toMatchObject({ target: 'note', alias: 'alias in table' })
  })
})

describe('parseNote', () => {
  const sample = `---
title: Plan del módulo
tags: [project, plan]
status: activo
---

# Heading uno

Texto con [[otra-nota|alias]] y ![[imagen.png]] y #etiqueta/anidada pero no #123.

\`\`\`js
const x = "[[no-es-enlace]] #tampoco"
\`\`\`

## Sección dos

Un [enlace markdown](carpeta/nota%20con%20espacios.md#parte) y [externo](https://example.com).
`

  it('reads frontmatter, title, tags from both places and ignores code blocks', () => {
    const parsed = parseNote(sample, 'projects/plan.md')
    expect(parsed.title).toBe('Plan del módulo')
    expect(parsed.frontmatter.status).toBe('activo')
    expect(parsed.tags).toEqual(['etiqueta/anidada', 'plan', 'project'])
    expect(parsed.links.map((l) => [l.target, l.embed, l.kind])).toEqual([
      ['otra-nota', false, 'wiki'],
      ['imagen.png', true, 'wiki'],
      ['carpeta/nota con espacios.md', false, 'markdown']
    ])
    expect(parsed.links[2].heading).toBe('parte')
    expect(parsed.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Heading uno'],
      [2, 'Sección dos']
    ])
  })

  it('chunks the body by section and keeps the heading path', () => {
    const parsed = parseNote(sample, 'projects/plan.md')
    expect(parsed.chunks.map((c) => c.headingPath)).toEqual([['Heading uno'], ['Heading uno', 'Sección dos']])
    expect(parsed.chunks[1].text).toContain('enlace markdown')
  })

  it('falls back to the file name when there is no title or H1', () => {
    expect(parseNote('solo texto', 'inbox/idea-suelta.md').title).toBe('idea-suelta')
  })

  it('reports a broken frontmatter instead of throwing', () => {
    const parsed = parseNote('---\ntags: [a\n---\n\nbody', 'x.md')
    expect(parsed.frontmatterError).not.toBeNull()
    expect(parsed.frontmatter).toEqual({})
  })
})

describe('LinkResolver', () => {
  const resolver = new LinkResolver([
    'projects/sincrogitexclude.md',
    'decisions/2026-11-23-plan.md',
    'people/ana.md',
    'archive/people/ana.md',
    'assets/diagram.png',
    'README.md'
  ])

  it('resolves by base name, case-insensitively', () => {
    expect(resolver.resolve('SincroGitExclude', 'inbox/x.md')).toBe('projects/sincrogitexclude.md')
  })

  it('prefers the shortest path when several notes share a name', () => {
    expect(resolver.resolve('ana', 'projects/x.md')).toBe('people/ana.md')
  })

  it('prefers a note in the same folder', () => {
    expect(resolver.resolve('ana', 'archive/people/other.md')).toBe('archive/people/ana.md')
  })

  it('resolves partial paths and attachments with extension', () => {
    expect(resolver.resolve('people/ana', 'x.md')).toBe('people/ana.md')
    expect(resolver.resolve('diagram.png', 'x.md')).toBe('assets/diagram.png')
  })

  it('returns null for a missing note', () => {
    expect(resolver.resolve('does-not-exist', 'x.md')).toBeNull()
  })
})

describe('SpaceIndex', () => {
  beforeEach(() => {
    put('projects/sincrogitexclude.md', '# SincroGitExclude\n\nVer [[2026-11-23-decisión]] y #electron.\n')
    put('decisions/2026-11-23-decisión.md', '---\ntags: [decision]\n---\n\n# Decisión de cifrado\n\nArgon2id y XChaCha20.\n')
    put('inbox/suelta.md', 'Nota sin enlaces que menciona [[no-existe]].\n')
    put('.obsidian/workspace.json', '{}')
    put('shared/team/nota.md', '# Compartida\n')
    put('assets/img.png', 'png')
  })

  it('indexes notes, skips hidden folders and excluded child spaces', async () => {
    const index = new SpaceIndex(root, { excludeDirs: ['shared/team'] })
    await index.build()
    expect([...index.notes.keys()].sort()).toEqual([
      'decisions/2026-11-23-decisión.md',
      'inbox/suelta.md',
      'projects/sincrogitexclude.md'
    ])
    expect(index.files.has('assets/img.png')).toBe(true)
  })

  it('finds notes without accents and ranks the title first', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    const hits = index.search('decision cifrado')
    expect(hits[0].path).toBe('decisions/2026-11-23-decisión.md')
    expect(hits[0].snippet.length).toBeGreaterThan(0)
  })

  it('computes backlinks and unresolved links', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    expect(index.backlinks('decisions/2026-11-23-decisión.md').map((b) => b.from)).toEqual([
      'projects/sincrogitexclude.md'
    ])
    expect(index.unresolvedLinks().map((u) => u.target)).toEqual(['no-existe'])
  })

  it('answers a natural question by ignoring words like por, qué or en', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    expect(index.search('¿por qué usamos argon2id en el cifrado?')[0].path).toBe('decisions/2026-11-23-decisión.md')
  })

  it('filters by folder and tag', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    expect(index.search('argon2id', { tags: ['decision'] }).map((h) => h.path)).toEqual([
      'decisions/2026-11-23-decisión.md'
    ])
    expect(index.search('argon2id', { folder: 'projects' })).toEqual([])
  })

  it('updates incrementally when a note changes or disappears', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    put('inbox/suelta.md', 'Ahora habla de [[sincrogitexclude]].\n')
    expect(await index.updateFile('inbox/suelta.md')).toBe('changed')
    expect(index.backlinks('projects/sincrogitexclude.md').map((b) => b.from)).toEqual(['inbox/suelta.md'])
    unlinkSync(join(root, 'inbox/suelta.md'))
    expect(await index.updateFile('inbox/suelta.md')).toBe('removed')
    expect(index.notes.has('inbox/suelta.md')).toBe(false)
  })

  it('builds a tree with folders first and note counts', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    const tree = index.tree()
    expect(tree.children!.map((c) => c.name)).toEqual(['decisions', 'inbox', 'projects', 'shared'])
    expect(tree.noteCount).toBe(4)
  })
})

describe('resolveInSpace', () => {
  it('rejects traversal, absolute paths and symlinks that escape the space', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sge-out-'))
    try {
      symlinkSync(outside, join(root, 'escape'))
      expect(() => resolveInSpace(root, '../etc/passwd')).toThrow(PathOutsideSpaceError)
      expect(() => resolveInSpace(root, '/etc/passwd')).toThrow(PathOutsideSpaceError)
      expect(() => resolveInSpace(root, 'escape/secret.md')).toThrow(PathOutsideSpaceError)
      expect(resolveInSpace(root, 'notes/new.md')).toBe(join(root, 'notes', 'new.md'))
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('foldText', () => {
  it('removes diacritics so Spanish words match without accents', () => {
    expect(foldText('Decisión Pingüino Ñandú')).toBe('decision pinguino nandu')
  })
})

describe('indexed text', () => {
  it('keeps list items apart so snippets do not glue words together', () => {
    const parsed = parseNote('- datos cifrados.\n- Login delegado\n\n| a | b |\n|---|---|\n| uno | dos |\n', 'x.md')
    expect(parsed.text).toContain('cifrados.\nLogin')
    expect(parsed.text).toContain('uno dos')
  })
})
