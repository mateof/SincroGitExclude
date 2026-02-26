import { create } from 'zustand'

interface WatcherStore {
  changedDeployments: Set<string>
  deletedDeployments: Set<string>
  markChanged: (deploymentId: string) => void
  markDeleted: (deploymentId: string) => void
  clearChanged: (deploymentId: string) => void
  clearAll: () => void
}

export const useWatcherStore = create<WatcherStore>((set) => ({
  changedDeployments: new Set(),
  deletedDeployments: new Set(),

  markChanged: (deploymentId) =>
    set((s) => {
      const next = new Set(s.changedDeployments)
      next.add(deploymentId)
      return { changedDeployments: next }
    }),

  markDeleted: (deploymentId) =>
    set((s) => {
      const next = new Set(s.deletedDeployments)
      next.add(deploymentId)
      return { deletedDeployments: next }
    }),

  clearChanged: (deploymentId) =>
    set((s) => {
      const next = new Set(s.changedDeployments)
      next.delete(deploymentId)
      return { changedDeployments: next }
    }),

  clearAll: () =>
    set({ changedDeployments: new Set(), deletedDeployments: new Set() })
}))
