import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { DEFAULT_DATA_DIR } from '../../app-paths'
import { pushEvent } from '../../events'
import type { KbService } from '../kb-service'
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS, modelSlug, presetFor } from './models'
import { OllamaEmbedder, OpenAiEmbedder, type Embedder } from './providers'
import { LocalEmbedder } from './local-embedder'
import { chunkRefs, VectorStore } from './vector-store'
import type { KbSearchHit, KbSearchOptions, KbSemanticConfig, KbSemanticStatus } from '../../../shared/kb/types'

const CONFIG_PATH = join(DEFAULT_DATA_DIR, 'kb-semantic.json')
const CACHE_DIR = join(DEFAULT_DATA_DIR, 'kb-cache')
const MODELS_DIR = join(DEFAULT_DATA_DIR, 'kb-models')
const BATCH = 16
const MAX_TEXT = 2000

function readConfig(): KbSemanticConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as KbSemanticConfig
      if (['local', 'ollama', 'openai', 'off'].includes(parsed.provider)) return parsed
    }
  } catch {
    return { provider: 'off', model: DEFAULT_LOCAL_MODEL }
  }
  return { provider: 'off', model: DEFAULT_LOCAL_MODEL }
}

export class SemanticService {
  private config = readConfig()
  private embedder: Embedder | null = null
  private dims: number | null = null
  private stores = new Map<string, VectorStore>()
  private queue = new Set<string>()
  private working = false
  private error: string | null = null
  private progress: number | null = null
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private totals = new Map<string, number>()

  constructor(private readonly kb: KbService) {}

  getConfig(): KbSemanticConfig & { models: typeof LOCAL_MODELS } {
    return { ...this.config, models: LOCAL_MODELS }
  }

  async setConfig(next: KbSemanticConfig): Promise<KbSemanticStatus> {
    if (!['local', 'ollama', 'openai', 'off'].includes(next.provider)) throw new Error('Unknown provider')
    if (next.provider === 'local' && !presetFor(next.model)) throw new Error('Unknown local model')
    if ((next.provider === 'ollama' || next.provider === 'openai') && !next.endpoint) throw new Error('Set the endpoint of the embedding service')
    if (next.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(next.apiKeyEnv)) throw new Error('The API key must come from an environment variable name')
    await this.embedder?.dispose()
    this.embedder = null
    this.dims = null
    this.stores.clear()
    this.totals.clear()
    this.error = null
    this.config = { provider: next.provider, model: next.model, endpoint: next.endpoint, apiKeyEnv: next.apiKeyEnv }
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
    if (this.config.provider !== 'off') this.reindexAll()
    this.emit()
    return this.status()
  }

  ready(): boolean {
    return this.config.provider !== 'off' && this.error === null && this.stores.size > 0 && [...this.stores.values()].some((s) => s.size > 0)
  }

  status(): KbSemanticStatus {
    let embedded = 0
    let chunks = 0
    for (const [spaceId, store] of this.stores) {
      embedded += store.size
      chunks += this.totals.get(spaceId) ?? store.size
    }
    return {
      provider: this.config.provider,
      model: this.config.model,
      ready: this.ready(),
      indexing: this.working || this.queue.size > 0,
      chunks,
      embedded,
      error: this.error,
      downloadProgress: this.progress
    }
  }

  private emit(): void {
    pushEvent('kb:semantic-status', this.status())
  }

  private getEmbedder(): Embedder {
    if (this.embedder) return this.embedder
    const { provider, model, endpoint, apiKeyEnv } = this.config
    if (provider === 'local') {
      const preset = presetFor(model)
      if (!preset) throw new Error('Unknown local model')
      this.dims = preset.dims
      this.embedder = new LocalEmbedder(preset, MODELS_DIR, (p) => {
        this.progress = p
        this.emit()
      })
    } else if (provider === 'ollama') {
      this.embedder = new OllamaEmbedder(endpoint ?? 'http://127.0.0.1:11434', model)
    } else if (provider === 'openai') {
      this.embedder = new OpenAiEmbedder(endpoint ?? '', model, apiKeyEnv ? process.env[apiKeyEnv] : undefined)
    } else {
      throw new Error('Semantic search is off')
    }
    return this.embedder
  }

  private async dimsOf(embedder: Embedder): Promise<number> {
    if (this.dims) return this.dims
    const [probe] = await embedder.embed(['dimension probe'])
    this.dims = probe.length
    return this.dims
  }

  private storeFor(spaceId: string, dims: number): VectorStore {
    const existing = this.stores.get(spaceId)
    if (existing && existing.dims === dims) return existing
    const store = new VectorStore(join(CACHE_DIR, spaceId, modelSlug(this.config.provider, this.config.model)), dims)
    store.load()
    this.stores.set(spaceId, store)
    return store
  }

  private passageText(title: string, heading: string, text: string): string {
    const preset = this.config.provider === 'local' ? presetFor(this.config.model) : null
    const body = `${heading ? `${heading}\n` : ''}${text}`.slice(0, MAX_TEXT)
    return `${preset ? preset.passagePrefix(title) : `${title}\n`}${body}`
  }

  private queryText(query: string): string {
    const preset = this.config.provider === 'local' ? presetFor(this.config.model) : null
    return `${preset?.queryPrefix ?? ''}${query}`
  }

  onSpaceChanged(spaceId: string): void {
    if (this.config.provider === 'off') return
    const timer = this.timers.get(spaceId)
    if (timer) clearTimeout(timer)
    this.timers.set(
      spaceId,
      setTimeout(() => {
        this.timers.delete(spaceId)
        this.enqueue(spaceId)
      }, 3000)
    )
  }

  reindexAll(): void {
    for (const space of this.kb.listSpaces()) if (space.exists && !space.locked) this.enqueue(space.id)
  }

  async start(): Promise<void> {
    if (this.config.provider === 'off') return
    this.reindexAll()
  }

  forget(spaceId: string): void {
    this.stores.delete(spaceId)
    rmSync(join(CACHE_DIR, spaceId), { recursive: true, force: true })
  }

  private enqueue(spaceId: string): void {
    this.queue.add(spaceId)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.working) return
    this.working = true
    this.emit()
    try {
      while (this.queue.size > 0) {
        const [spaceId] = this.queue
        this.queue.delete(spaceId)
        try {
          await this.indexSpace(spaceId)
          this.error = null
        } catch (error) {
          this.error = (error as Error).message || String(error)
          log.warn(`Semantic indexing failed for ${spaceId}:`, error)
        }
        this.emit()
      }
    } finally {
      this.working = false
      this.emit()
    }
  }

  private async indexSpace(spaceId: string): Promise<void> {
    if (this.config.provider === 'off') return
    const index = await this.kb.ensureIndex(spaceId)
    const embedder = this.getEmbedder()
    const dims = await this.dimsOf(embedder)
    const store = this.storeFor(spaceId, dims)
    const refs = chunkRefs(index)
    this.totals.set(spaceId, refs.length)
    store.retain(refs)
    const missing = store.missing(refs)
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH)
      const vectors = await embedder.embed(batch.map((r) => this.passageText(r.title, r.heading, r.text)))
      batch.forEach((ref, j) => store.put(ref, vectors[j]))
      if ((i / BATCH) % 8 === 7) store.save()
      this.emit()
    }
    store.save()
  }

  async search(query: string, options: KbSearchOptions): Promise<KbSearchHit[]> {
    if (this.config.provider === 'off') throw new Error('Semantic search is off. Turn it on in Settings > Knowledge base.')
    const embedder = this.getEmbedder()
    const dims = await this.dimsOf(embedder)
    const [vector] = await embedder.embed([this.queryText(query)])
    const limit = options.limit ?? 20
    const ids = options.spaceIds && options.spaceIds.length > 0 ? options.spaceIds : this.kb.listSpaces().map((s) => s.id)
    const wantedTags = (options.tags ?? []).map((t) => t.replace(/^#/, '').toLowerCase())
    const folder = options.folder?.replace(/^\/+|\/+$/g, '')
    const hits: KbSearchHit[] = []
    for (const spaceId of ids) {
      const index = await this.kb.ensureIndex(spaceId)
      const store = this.storeFor(spaceId, dims)
      for (const hit of store.search(vector, limit, (path) => {
        const note = index.notes.get(path)
        if (!note) return false
        if (folder && !(path === folder || path.startsWith(`${folder}/`))) return false
        if (wantedTags.length === 0) return true
        const tags = note.tags.map((t) => t.toLowerCase())
        return wantedTags.every((w) => tags.some((t) => t === w || t.startsWith(`${w}/`)))
      })) {
        const note = index.notes.get(hit.path)!
        const chunkIndex = Number(hit.key.slice(hit.key.lastIndexOf('#') + 1))
        const text = note.chunks[chunkIndex]?.text ?? note.text
        const flat = text.replace(/\s+/g, ' ').trim()
        hits.push({
          spaceId,
          path: hit.path,
          title: note.title,
          score: hit.score,
          snippet: flat.slice(0, 200) + (flat.length > 200 ? '…' : ''),
          tags: note.tags,
          heading: hit.heading || undefined,
          matchedBy: ['semantic']
        })
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  async dispose(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t)
    await this.embedder?.dispose()
  }
}
