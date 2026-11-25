import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { once } from 'events'
import { finished } from 'stream/promises'
import type { UpdateAsset } from './release'

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>

const STALL_MS = 60_000

export async function downloadAsset(
  fetcher: FetchLike,
  asset: UpdateAsset,
  target: string,
  signal: AbortSignal,
  onProgress: (received: number) => void,
  stallMs = STALL_MS
): Promise<void> {
  const stall = new AbortController()
  let timer = setTimeout(() => stall.abort(new Error('The download stalled')), stallMs)
  const combined = AbortSignal.any([signal, stall.signal])
  const out = createWriteStream(target, { flags: 'wx', mode: 0o600 })
  const closed = finished(out)
  closed.catch(() => undefined)
  try {
    const response = await fetcher(asset.url, { signal: combined })
    if (!response.ok || !response.body) throw new Error(`The download failed (HTTP ${response.status})`)
    const hash = createHash('sha256')
    let received = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      combined.throwIfAborted()
      clearTimeout(timer)
      timer = setTimeout(() => stall.abort(new Error('The download stalled')), stallMs)
      received += chunk.byteLength
      if (received > asset.size) throw new Error('The download is larger than announced')
      hash.update(chunk)
      if (!out.write(chunk)) await once(out, 'drain', { signal: combined })
      onProgress(received)
    }
    combined.throwIfAborted()
    out.end()
    await closed
    if (received !== asset.size) throw new Error('The download is incomplete')
    if (hash.digest('hex') !== asset.sha256) throw new Error('The SHA-256 of the download does not match the release')
  } catch (error) {
    out.destroy()
    if (stall.signal.aborted && !signal.aborted) throw stall.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
  }
}
