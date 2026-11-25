export interface LocalModelPreset {
  id: string
  label: string
  dims: number
  dtype: 'q8' | 'fp32'
  sizeMb: number
  queryPrefix: string
  passagePrefix: (title: string) => string
}

export const LOCAL_MODELS: LocalModelPreset[] = [
  {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    label: 'EmbeddingGemma 300M',
    dims: 768,
    dtype: 'q8',
    sizeMb: 330,
    queryPrefix: 'task: search result | query: ',
    passagePrefix: (title) => `title: ${title.replace(/\|/g, ' ') || 'none'} | text: `
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: 'Multilingual MiniLM L12',
    dims: 384,
    dtype: 'q8',
    sizeMb: 120,
    queryPrefix: '',
    passagePrefix: () => ''
  }
]

export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id

export type LocalModelOption = Pick<LocalModelPreset, 'id' | 'label' | 'dims' | 'sizeMb'>

export function modelOptions(): LocalModelOption[] {
  return LOCAL_MODELS.map(({ id, label, dims, sizeMb }) => ({ id, label, dims, sizeMb }))
}

export function presetFor(model: string): LocalModelPreset | null {
  return LOCAL_MODELS.find((m) => m.id === model) ?? null
}

export function modelSlug(provider: string, model: string): string {
  return `${provider}-${model}`.replace(/[^a-zA-Z0-9.-]+/g, '_').slice(0, 120)
}
