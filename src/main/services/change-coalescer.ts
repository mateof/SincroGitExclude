export interface CoalescedBatch {
  paths: string[]
  removed: boolean
}

interface PendingBatch {
  paths: Set<string>
  removed: boolean
  firstAt: number
  timer: ReturnType<typeof setTimeout>
}

export class ChangeCoalescer {
  private pending = new Map<string, PendingBatch>()

  constructor(
    private readonly onFlush: (key: string, batch: CoalescedBatch) => void,
    private readonly quietMs = 400,
    private readonly maxWaitMs = 3000
  ) {}

  push(key: string, path: string, removed = false): void {
    const now = Date.now()
    const current = this.pending.get(key)
    if (current) clearTimeout(current.timer)

    const batch: PendingBatch = current ?? {
      paths: new Set(),
      removed: false,
      firstAt: now,
      timer: undefined as unknown as ReturnType<typeof setTimeout>
    }
    if (removed) batch.removed = true
    else batch.paths.add(path)

    const delay = Math.max(0, Math.min(this.quietMs, batch.firstAt + this.maxWaitMs - now))
    batch.timer = setTimeout(() => this.flush(key), delay)
    this.pending.set(key, batch)
  }

  flush(key: string): void {
    const batch = this.pending.get(key)
    if (!batch) return
    clearTimeout(batch.timer)
    this.pending.delete(key)
    this.onFlush(key, { paths: [...batch.paths], removed: batch.removed })
  }

  cancel(key: string): void {
    const batch = this.pending.get(key)
    if (!batch) return
    clearTimeout(batch.timer)
    this.pending.delete(key)
  }

  dispose(): void {
    for (const batch of this.pending.values()) clearTimeout(batch.timer)
    this.pending.clear()
  }
}
