const statuses = new Map<string, boolean>()

export const changeStatus = {
  get(deploymentId: string): boolean | undefined {
    return statuses.get(deploymentId)
  },
  set(deploymentId: string, hasChanges: boolean): void {
    statuses.set(deploymentId, hasChanges)
  },
  invalidate(deploymentId: string): void {
    statuses.delete(deploymentId)
  },
  invalidateAll(): void {
    statuses.clear()
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}
