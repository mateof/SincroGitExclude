import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SpaceIndex } from '../index/space-index'

export interface ChunkRef {
  key: string
  hash: string
  path: string
  title: string
  heading: string
  line: number
  text: string
}

interface StoredEntry {
  key: string
  hash: string
  path: string
  heading: string
  line: number
}

export interface VectorHit {
  path: string
  heading: string
  line: number
  score: number
  key: string
}

export function chunkRefs(index: SpaceIndex): ChunkRef[] {
  const out: ChunkRef[] = []
  for (const note of index.notes.values()) {
    note.chunks.forEach((chunk, i) => {
      const heading = chunk.headingPath.join(' › ')
      const text = chunk.text.trim()
      if (!text) return
      out.push({
        key: `${note.path}#${i}`,
        hash: createHash('sha256').update(`${note.title}\n${heading}\n${text}`).digest('hex').slice(0, 32),
        path: note.path,
        title: note.title,
        heading,
        line: chunk.line,
        text
      })
    })
  }
  return out
}

export class VectorStore {
  private entries: StoredEntry[] = []
  private vectors: Float32Array[] = []
  private byKey = new Map<string, number>()

  constructor(
    private readonly dir: string,
    readonly dims: number
  ) {}

  get size(): number {
    return this.entries.length
  }

  load(): void {
    const meta = join(this.dir, 'vectors.json')
    const bin = join(this.dir, 'vectors.bin')
    if (!existsSync(meta) || !existsSync(bin)) return
    try {
      const parsed = JSON.parse(readFileSync(meta, 'utf-8')) as { dims: number; entries: StoredEntry[] }
      if (parsed.dims !== this.dims) return
      const buffer = readFileSync(bin)
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4))
      if (floats.length !== parsed.entries.length * this.dims) return
      this.entries = parsed.entries
      this.vectors = parsed.entries.map((_, i) => floats.slice(i * this.dims, (i + 1) * this.dims))
      this.byKey = new Map(this.entries.map((e, i) => [e.key, i]))
    } catch {
      this.entries = []
      this.vectors = []
      this.byKey.clear()
    }
  }

  save(): void {
    mkdirSync(this.dir, { recursive: true })
    const flat = new Float32Array(this.entries.length * this.dims)
    this.vectors.forEach((v, i) => flat.set(v, i * this.dims))
    writeFileSync(join(this.dir, 'vectors.bin.tmp'), Buffer.from(flat.buffer))
    writeFileSync(join(this.dir, 'vectors.json.tmp'), JSON.stringify({ dims: this.dims, entries: this.entries }))
    renameSync(join(this.dir, 'vectors.bin.tmp'), join(this.dir, 'vectors.bin'))
    renameSync(join(this.dir, 'vectors.json.tmp'), join(this.dir, 'vectors.json'))
  }

  missing(refs: ChunkRef[]): ChunkRef[] {
    return refs.filter((r) => {
      const i = this.byKey.get(r.key)
      return i === undefined || this.entries[i].hash !== r.hash
    })
  }

  retain(refs: ChunkRef[]): void {
    const wanted = new Map(refs.map((r) => [r.key, r]))
    const entries: StoredEntry[] = []
    const vectors: Float32Array[] = []
    this.entries.forEach((e, i) => {
      const ref = wanted.get(e.key)
      if (ref && ref.hash === e.hash) {
        entries.push({ ...e, path: ref.path, heading: ref.heading, line: ref.line })
        vectors.push(this.vectors[i])
      }
    })
    this.entries = entries
    this.vectors = vectors
    this.byKey = new Map(entries.map((e, i) => [e.key, i]))
  }

  put(ref: ChunkRef, vector: Float32Array): void {
    if (vector.length !== this.dims) throw new Error(`Expected ${this.dims} dimensions, got ${vector.length}`)
    const normalized = normalize(vector)
    const entry: StoredEntry = { key: ref.key, hash: ref.hash, path: ref.path, heading: ref.heading, line: ref.line }
    const existing = this.byKey.get(ref.key)
    if (existing !== undefined) {
      this.entries[existing] = entry
      this.vectors[existing] = normalized
    } else {
      this.byKey.set(ref.key, this.entries.length)
      this.entries.push(entry)
      this.vectors.push(normalized)
    }
  }

  search(query: Float32Array, limit: number, accept: (path: string) => boolean = () => true): VectorHit[] {
    const q = normalize(query)
    const best = new Map<string, VectorHit>()
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]
      if (!accept(e.path)) continue
      const v = this.vectors[i]
      let score = 0
      for (let d = 0; d < q.length; d++) score += q[d] * v[d]
      const current = best.get(e.path)
      if (!current || score > current.score) best.set(e.path, { path: e.path, heading: e.heading, line: e.line, score, key: e.key })
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

export interface FusableHit {
  spaceId: string
  path: string
}

export function fuseRrf<T extends FusableHit>(lists: T[][], k = 60): Array<{ item: T; score: number; sources: number[] }> {
  const merged = new Map<string, { item: T; score: number; sources: number[] }>()
  lists.forEach((list, source) => {
    list.forEach((item, rank) => {
      const id = `${item.spaceId}\u0000${item.path}`
      const entry = merged.get(id) ?? { item, score: 0, sources: [] }
      entry.score += 1 / (k + rank + 1)
      if (!entry.sources.includes(source)) entry.sources.push(source)
      merged.set(id, entry)
    })
  })
  return [...merged.values()].sort((a, b) => b.score - a.score)
}
