import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { SpaceIndex } from '../src/main/kb/index/space-index'
import { chunkRefs, fuseRrf, VectorStore } from '../src/main/kb/semantic/vector-store'
import { OllamaEmbedder, OpenAiEmbedder } from '../src/main/kb/semantic/providers'
import { LOCAL_MODELS, presetFor } from '../src/main/kb/semantic/models'

let root: string
let cache: string

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}

function fakeVector(text: string): Float32Array {
  const v = new Float32Array(4)
  if (/cifrad|secret|clave/i.test(text)) v[0] = 1
  if (/git|repositori/i.test(text)) v[1] = 1
  if (/receta|comida|lentejas/i.test(text)) v[2] = 1
  v[3] = 0.1
  return v
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sge-sem-'))
  cache = mkdtempSync(join(tmpdir(), 'sge-semc-'))
  put('decisions/cifrado.md', '# Cifrado\n\nUsamos claves por espacio.\n\n## Recuperación\n\nCódigo de 24 palabras.\n')
  put('projects/git.md', '# Repositorio\n\nSync con git en el NAS.\n')
  put('inbox/receta.md', '# Lentejas\n\nReceta con chorizo.\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cache, { recursive: true, force: true })
})

describe('vector store', () => {
  it('embeds only new or changed chunks and survives a restart', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    const store = new VectorStore(cache, 4)
    const refs = chunkRefs(index)
    expect(refs.map((r) => r.heading)).toContain('Cifrado › Recuperación')
    for (const ref of store.missing(refs)) store.put(ref, fakeVector(ref.text))
    store.save()

    const reloaded = new VectorStore(cache, 4)
    reloaded.load()
    expect(reloaded.size).toBe(refs.length)
    expect(reloaded.missing(refs)).toEqual([])

    put('inbox/receta.md', '# Lentejas\n\nReceta nueva con pimentón.\n')
    await index.updateFile('inbox/receta.md')
    const next = chunkRefs(index)
    expect(reloaded.missing(next).map((r) => r.path)).toEqual(['inbox/receta.md'])
  })

  it('drops vectors of deleted notes and ignores a cache built with other dimensions', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    const store = new VectorStore(cache, 4)
    const refs = chunkRefs(index)
    for (const ref of refs) store.put(ref, fakeVector(ref.text))
    store.retain(refs.filter((r) => r.path !== 'inbox/receta.md'))
    expect(store.search(fakeVector('lentejas'), 5).map((h) => h.path)).not.toContain('inbox/receta.md')
    store.save()
    const other = new VectorStore(cache, 8)
    other.load()
    expect(other.size).toBe(0)
  })

  it('returns the best chunk per note and respects the filter', async () => {
    const index = new SpaceIndex(root)
    await index.build()
    const store = new VectorStore(cache, 4)
    for (const ref of chunkRefs(index)) store.put(ref, fakeVector(ref.text))
    const hits = store.search(fakeVector('¿dónde guardo la clave secreta?'), 3)
    expect(hits[0].path).toBe('decisions/cifrado.md')
    expect(new Set(hits.map((h) => h.path)).size).toBe(hits.length)
    expect(store.search(fakeVector('clave'), 3, (p) => p.startsWith('projects/'))[0].path).toBe('projects/git.md')
  })
})

describe('hybrid fusion', () => {
  it('rewards notes found by both searches', () => {
    const text = [
      { spaceId: 's', path: 'a.md' },
      { spaceId: 's', path: 'b.md' }
    ]
    const semantic = [
      { spaceId: 's', path: 'c.md' },
      { spaceId: 's', path: 'b.md' }
    ]
    const fused = fuseRrf([text, semantic])
    expect(fused[0].item.path).toBe('b.md')
    expect(fused[0].sources).toEqual([0, 1])
    expect(fused.map((f) => f.item.path).sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })
})

describe('embedding providers', () => {
  it('talks to Ollama /api/embed', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fake = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ embeddings: [[1, 0], [0, 1]] }), text: async () => '' }
    }
    const vectors = await new OllamaEmbedder('http://nas:11434/', 'bge-m3', fake).embed(['a', 'b'])
    expect(calls[0]).toEqual({ url: 'http://nas:11434/api/embed', body: { model: 'bge-m3', input: ['a', 'b'] } })
    expect(Array.from(vectors[1])).toEqual([0, 1])
  })

  it('talks to an OpenAI compatible endpoint and keeps the order of the answers', async () => {
    let auth = ''
    const fake = async (_url: string, init: { headers: Record<string, string> }) => {
      auth = init.headers.Authorization
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 0] }] }),
        text: async () => ''
      }
    }
    const vectors = await new OpenAiEmbedder('http://localhost:1234/v1', 'text-embedding', 'key-123', fake).embed(['x', 'y'])
    expect(auth).toBe('Bearer key-123')
    expect(Array.from(vectors[0])).toEqual([3, 0])
  })

  it('reports a failing service with its status', async () => {
    const fake = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => 'model not found' })
    await expect(new OllamaEmbedder('http://x', 'm', fake).embed(['a'])).rejects.toThrow(/404.*model not found/)
  })

  it('offers multilingual local models with the prompts each one expects', () => {
    expect(LOCAL_MODELS.length).toBeGreaterThan(1)
    expect(presetFor('onnx-community/embeddinggemma-300m-ONNX')?.queryPrefix).toBe('task: search result | query: ')
  })
})
