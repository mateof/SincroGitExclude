export interface Embedder {
  readonly id: string
  embed(texts: string[]): Promise<Float32Array[]>
  dispose(): Promise<void>
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

async function post(fetchImpl: FetchLike, url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Embedding request failed (${response.status}): ${text.slice(0, 200)}`)
  }
  return response.json()
}

function toVectors(raw: unknown, count: number): Float32Array[] {
  if (!Array.isArray(raw) || raw.length !== count) throw new Error('The embedding service returned an unexpected answer')
  return raw.map((v) => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) throw new Error('The embedding service returned an invalid vector')
    return Float32Array.from(v as number[])
  })
}

export class OllamaEmbedder implements Embedder {
  readonly id: string
  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {
    this.id = `ollama:${model}`
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const json = (await post(this.fetchImpl, `${this.endpoint.replace(/\/+$/, '')}/api/embed`, { model: this.model, input: texts })) as {
      embeddings?: unknown
    }
    return toVectors(json.embeddings, texts.length)
  }

  async dispose(): Promise<void> {}
}

export class OpenAiEmbedder implements Embedder {
  readonly id: string
  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {
    this.id = `openai:${model}`
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const base = this.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '')
    const json = (await post(
      this.fetchImpl,
      `${base}/v1/embeddings`,
      { model: this.model, input: texts },
      this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
    )) as { data?: Array<{ embedding?: unknown; index?: number }> }
    if (!Array.isArray(json.data)) throw new Error('The embedding service returned an unexpected answer')
    const ordered = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding)
    return toVectors(ordered, texts.length)
  }

  async dispose(): Promise<void> {}
}
