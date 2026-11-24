import Module from 'module'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown

const moduleWithLoader = Module as unknown as { _load: Loader }
const originalLoad = moduleWithLoader._load
const imagesUnavailable = (): never => {
  throw new Error('Image processing is not available in the embeddings process')
}
moduleWithLoader._load = function load(this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
  if (request === 'sharp') return imagesUnavailable
  return originalLoad.call(this, request, parent, isMain)
}

const { pipeline, env } = require('@huggingface/transformers') as typeof import('@huggingface/transformers')

interface EmbedRequest {
  type: 'embed'
  id: number
  model: string
  dtype: 'q8' | 'fp32'
  cacheDir: string
  texts: string[]
}

interface ParentPort {
  on: (event: 'message', listener: (event: { data: EmbedRequest }) => void) => void
  postMessage: (message: unknown) => void
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort

let current: { key: string; extractor: Promise<FeatureExtractionPipeline> } | null = null

function extractorFor(request: EmbedRequest): Promise<FeatureExtractionPipeline> {
  const key = `${request.model}|${request.dtype}|${request.cacheDir}`
  if (current?.key === key) return current.extractor
  env.cacheDir = request.cacheDir
  env.allowLocalModels = false
  const extractor = pipeline('feature-extraction', request.model, {
    dtype: request.dtype,
    progress_callback: (progress: unknown) => port.postMessage({ type: 'progress', progress })
  }) as Promise<FeatureExtractionPipeline>
  current = { key, extractor }
  extractor.catch(() => {
    if (current?.key === key) current = null
  })
  return extractor
}

port.on('message', async ({ data }) => {
  if (data?.type !== 'embed') return
  try {
    const extractor = await extractorFor(data)
    const output = await extractor(data.texts, { pooling: 'mean', normalize: true })
    const [count, dims] = output.dims as [number, number]
    const flat = output.data as Float32Array
    const vectors: Float32Array[] = []
    for (let i = 0; i < count; i++) vectors.push(flat.slice(i * dims, (i + 1) * dims))
    port.postMessage({ type: 'result', id: data.id, vectors })
  } catch (error) {
    port.postMessage({ type: 'error', id: data.id, message: (error as Error).message || String(error) })
  }
})
