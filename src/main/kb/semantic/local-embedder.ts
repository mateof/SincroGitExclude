import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import type { Embedder } from './providers'
import type { LocalModelPreset } from './models'

interface Pending {
  resolve: (vectors: Float32Array[]) => void
  reject: (error: Error) => void
}

export class LocalEmbedder implements Embedder {
  readonly id: string
  private child: UtilityProcess | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1

  constructor(
    private readonly preset: LocalModelPreset,
    private readonly cacheDir: string,
    private readonly onProgress: (progress: number | null) => void
  ) {
    this.id = `local:${preset.id}`
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(join(__dirname, 'kb-embed-worker.js'), [], {
      serviceName: 'SincroGitExclude embeddings',
      stdio: 'pipe'
    })
    child.stderr?.on('data', (chunk: Buffer) => log.debug(`[embeddings] ${chunk.toString('utf-8').trim()}`))
    child.on('message', (message: { type: string; id?: number; vectors?: Float32Array[]; message?: string; progress?: { status?: string; progress?: number } }) => {
      if (message.type === 'progress') {
        const p = message.progress
        if (p?.status === 'progress' && typeof p.progress === 'number') this.onProgress(Math.round(p.progress))
        if (p?.status === 'ready') this.onProgress(null)
        return
      }
      const pending = message.id !== undefined ? this.pending.get(message.id) : undefined
      if (!pending) return
      this.pending.delete(message.id!)
      if (message.type === 'result' && message.vectors) pending.resolve(message.vectors.map((v) => Float32Array.from(v)))
      else pending.reject(new Error(message.message || 'Embedding failed'))
    })
    child.on('exit', (code) => {
      this.child = null
      for (const p of this.pending.values()) p.reject(new Error(`The embeddings process stopped (${code})`))
      this.pending.clear()
    })
    this.child = child
    return child
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ type: 'embed', id, model: this.preset.id, dtype: this.preset.dtype, cacheDir: this.cacheDir, texts })
    })
  }

  async dispose(): Promise<void> {
    this.child?.kill()
    this.child = null
  }
}
