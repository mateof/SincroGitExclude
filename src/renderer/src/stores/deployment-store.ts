import { create } from 'zustand'
import type { Deployment } from '../types'
import type { IpcResult } from '../types'

interface DeploymentStore {
  deployments: Deployment[]
  loading: boolean
  loadDeployments: (fileId: string) => Promise<void>
  createDeployment: (
    fileId: string,
    repoPath: string,
    fileRelativePath: string,
    sourceBranch?: string,
    sourceCommit?: string,
    autoExclude?: boolean
  ) => Promise<Deployment | null>
  deactivateDeployment: (id: string) => Promise<boolean>
  reactivateDeployment: (id: string) => Promise<boolean>
  deleteDeployment: (id: string, deleteFromDisk?: boolean) => Promise<boolean>
  syncDeployment: (id: string) => Promise<boolean>
  checkChanges: (id: string) => Promise<boolean>
  checkExclude: (id: string) => Promise<boolean>
  updateDeploymentStatus: (id: string, updates: Partial<Deployment>) => void
  clear: () => void
}

function mapDeploymentRow(row: Record<string, unknown>): Deployment {
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    repoPath: row.repo_path as string,
    fileRelativePath: row.file_relative_path as string,
    branchName: row.branch_name as string,
    isActive: row.is_active === 1,
    lastSyncedAt: (row.last_synced_at as string) || null,
    createdAt: row.created_at as string,
    currentCommitHash: (row.current_commit_hash as string) || null
  }
}

export const useDeploymentStore = create<DeploymentStore>((set, get) => ({
  deployments: [],
  loading: false,

  loadDeployments: async (fileId) => {
    set({ loading: true })
    const result = await window.api.invoke<IpcResult<Record<string, unknown>[]>>(
      'deployments:list',
      fileId
    )
    if (result.success && result.data) {
      const deployments = result.data.map(mapDeploymentRow)

      // Check exclude status and changes for each active deployment
      for (const d of deployments) {
        if (d.isActive) {
          const [excludeResult, changesResult, globalExcludeResult] = await Promise.all([
            window.api.invoke<IpcResult<boolean>>('deployments:check-exclude', d.id),
            window.api.invoke<IpcResult<boolean>>('deployments:check-changes', d.id),
            window.api.invoke<IpcResult<boolean>>('exclude:check-global', d.id)
          ])
          d.isExcluded = excludeResult.success ? excludeResult.data : undefined
          d.hasChanges = changesResult.success ? changesResult.data : undefined
          d.isGloballyExcluded = globalExcludeResult.success ? globalExcludeResult.data : undefined
        }
        d.fullPath = `${d.repoPath}/${d.fileRelativePath}`.replace(/\\/g, '/')
      }

      set({ deployments })
    }
    set({ loading: false })
  },

  createDeployment: async (fileId, repoPath, fileRelativePath, sourceBranch, sourceCommit, autoExclude = true) => {
    const result = await window.api.invoke<IpcResult<Record<string, unknown>>>(
      'deployments:create',
      fileId,
      repoPath,
      fileRelativePath,
      sourceBranch,
      sourceCommit,
      autoExclude
    )
    if (result.success && result.data) {
      const deployment = mapDeploymentRow(result.data)
      deployment.isExcluded = autoExclude
      deployment.hasChanges = false
      deployment.fullPath = `${deployment.repoPath}/${deployment.fileRelativePath}`.replace(
        /\\/g,
        '/'
      )
      set((s) => ({ deployments: [deployment, ...s.deployments] }))
      return deployment
    }
    return null
  },

  deactivateDeployment: async (id) => {
    const result = await window.api.invoke<IpcResult>('deployments:deactivate', id)
    if (result.success) {
      set((s) => ({
        deployments: s.deployments.map((d) =>
          d.id === id ? { ...d, isActive: false } : d
        )
      }))
      return true
    }
    return false
  },

  reactivateDeployment: async (id) => {
    const result = await window.api.invoke<IpcResult>('deployments:reactivate', id)
    if (result.success) {
      set((s) => ({
        deployments: s.deployments.map((d) =>
          d.id === id ? { ...d, isActive: true } : d
        )
      }))
      return true
    }
    return false
  },

  deleteDeployment: async (id, deleteFromDisk = false) => {
    const result = await window.api.invoke<IpcResult>('deployments:delete', id, deleteFromDisk)
    if (result.success) {
      set((s) => ({
        deployments: s.deployments.filter((d) => d.id !== id)
      }))
      return true
    }
    return false
  },

  syncDeployment: async (id) => {
    const result = await window.api.invoke<IpcResult>('deployments:sync', id)
    return result.success === true
  },

  checkChanges: async (id) => {
    const result = await window.api.invoke<IpcResult<boolean>>(
      'deployments:check-changes',
      id
    )
    if (result.success) {
      set((s) => ({
        deployments: s.deployments.map((d) =>
          d.id === id ? { ...d, hasChanges: result.data } : d
        )
      }))
      return result.data === true
    }
    return false
  },

  checkExclude: async (id) => {
    const result = await window.api.invoke<IpcResult<boolean>>(
      'deployments:check-exclude',
      id
    )
    if (result.success) {
      set((s) => ({
        deployments: s.deployments.map((d) =>
          d.id === id ? { ...d, isExcluded: result.data } : d
        )
      }))
      return result.data === true
    }
    return false
  },

  updateDeploymentStatus: (id, updates) => {
    set((s) => ({
      deployments: s.deployments.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      )
    }))
  },

  clear: () => set({ deployments: [], loading: false })
}))
