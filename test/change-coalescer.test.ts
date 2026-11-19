import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChangeCoalescer, type CoalescedBatch } from '../src/main/services/change-coalescer'

describe('change coalescer', () => {
  let flushed: Array<[string, CoalescedBatch]>
  let coalescer: ChangeCoalescer

  beforeEach(() => {
    vi.useFakeTimers()
    flushed = []
    coalescer = new ChangeCoalescer((key, batch) => flushed.push([key, batch]), 400, 3000)
  })

  afterEach(() => {
    coalescer.dispose()
    vi.useRealTimers()
  })

  it('turns a burst of events into a single flush once things go quiet', () => {
    for (let i = 0; i < 500; i++) coalescer.push('dep', `/f/${i % 10}.txt`)
    vi.advanceTimersByTime(399)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)
    expect(flushed[0][1].paths).toHaveLength(10)
  })

  it('flushes a never-ending stream at least every max-wait interval', () => {
    for (let t = 0; t < 7000; t += 100) {
      coalescer.push('dep', `/f/${t}`)
      vi.advanceTimersByTime(100)
    }
    expect(flushed.length).toBeGreaterThanOrEqual(2)
    expect(flushed.length).toBeLessThanOrEqual(3)
  })

  it('keeps deployments independent', () => {
    coalescer.push('a', '/a')
    coalescer.push('b', '/b')
    vi.advanceTimersByTime(400)
    expect(flushed.map(([key]) => key).sort()).toEqual(['a', 'b'])
  })

  it('reports removals without listing them as changed paths', () => {
    coalescer.push('dep', '/gone', true)
    coalescer.push('dep', '/kept')
    vi.advanceTimersByTime(400)
    expect(flushed[0][1]).toEqual({ paths: ['/kept'], removed: true })
  })

  it('drops pending events of a deployment that stops being watched', () => {
    coalescer.push('dep', '/x')
    coalescer.cancel('dep')
    vi.advanceTimersByTime(5000)
    expect(flushed).toHaveLength(0)
  })
})
