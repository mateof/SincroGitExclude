import { create } from 'zustand'
import type {
  IpcResult,
  Repo,
  ExcludeEntry,
  RepoDeploymentRow,
  FileTag
} from '@/types'

interface RepoStore {
  repos: Repo[]
  loading: boolean
  loadRepos: () => Promise<void>
  addRepo: (
    path: string,
    description?: string,
    tagIds?: string[]
  ) => Promise<Repo | null>
  updateDescription: (id: string, description: string | null) => Promise<boolean>
  removeRepo: (id: string) => Promise<boolean>
  setRepoTags: (repoId: string, tagIds: string[]) => Promise<boolean>
  getRepoDetail: (id: string) => Promise<Repo | null>
  listExcludes: (id: string) => Promise<ExcludeEntry[]>
  addExclude: (id: string, pattern: string) => Promise<boolean>
  removeExclude: (
    id: string,
    lineNumber: number,
    expectedPattern: string
  ) => Promise<{ success: boolean; error?: string }>
  listRepoDeployments: (id: string) => Promise<RepoDeploymentRow[]>
}

function mapTags(raw: unknown): FileTag[] {
  if (!Array.isArray(raw)) return []
  return raw.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    color: t.color as string
  }))
}

function mapRepoRow(row: Record<string, unknown>): Repo {
  return {
    id: row.id as string,
    path: row.path as string,
    displayName: row.displayName as string,
    description: (row.description as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deploymentCount: (row.deploymentCount as number) ?? 0,
    filesCount: (row.filesCount as number) ?? 0,
    lastActivity: (row.lastActivity as string) ?? null,
    pathExists: row.pathExists !== false,
    isValidGit: row.isValidGit !== false,
    tags: mapTags(row.tags),
    currentBranch: (row.currentBranch as string) ?? null,
    remoteUrl: (row.remoteUrl as string) ?? null,
    hasUncommittedChangesExternal:
      (row.hasUncommittedChangesExternal as boolean) ?? undefined,
    excludeEntriesCount: (row.excludeEntriesCount as number) ?? undefined,
    hasManualExcludes: (row.hasManualExcludes as boolean) ?? undefined
  }
}

export const useRepoStore = create<RepoStore>((set, get) => ({
  repos: [],
  loading: false,

  loadRepos: async () => {
    set({ loading: true })
    const result = await window.api.invoke<IpcResult<Record<string, unknown>[]>>(
      'repos:list'
    )
    if (result.success && result.data) {
      set({ repos: result.data.map(mapRepoRow) })
    }
    set({ loading: false })
  },

  addRepo: async (path, description, tagIds) => {
    const result = await window.api.invoke<IpcResult<Record<string, unknown>>>(
      'repos:add',
      path,
      description,
      tagIds
    )
    if (result.success && result.data) {
      await get().loadRepos()
      const id = result.data.id as string
      return get().repos.find((r) => r.id === id) ?? null
    }
    if (!result.success && result.error) {
      throw new Error(result.error)
    }
    return null
  },

  updateDescription: async (id, description) => {
    const result = await window.api.invoke<IpcResult>(
      'repos:update-description',
      id,
      description
    )
    if (result.success) {
      set((s) => ({
        repos: s.repos.map((r) => (r.id === id ? { ...r, description } : r))
      }))
      return true
    }
    return false
  },

  removeRepo: async (id) => {
    const result = await window.api.invoke<IpcResult>('repos:remove', id)
    if (result.success) {
      set((s) => ({ repos: s.repos.filter((r) => r.id !== id) }))
      return true
    }
    if (result.error) throw new Error(result.error)
    return false
  },

  setRepoTags: async (repoId, tagIds) => {
    const result = await window.api.invoke<IpcResult>('repos:set-tags', repoId, tagIds)
    if (result.success) {
      await get().loadRepos()
      return true
    }
    return false
  },

  getRepoDetail: async (id) => {
    const result = await window.api.invoke<IpcResult<Record<string, unknown>>>(
      'repos:get',
      id
    )
    if (result.success && result.data) {
      const repo = mapRepoRow(result.data)
      set((s) => ({
        repos: s.repos.map((r) => (r.id === id ? { ...r, ...repo } : r))
      }))
      return repo
    }
    return null
  },

  listExcludes: async (id) => {
    const result = await window.api.invoke<IpcResult<ExcludeEntry[]>>(
      'repos:list-excludes',
      id
    )
    if (result.success && result.data) return result.data
    return []
  },

  addExclude: async (id, pattern) => {
    const result = await window.api.invoke<IpcResult>('repos:add-exclude', id, pattern)
    if (!result.success && result.error) throw new Error(result.error)
    return result.success
  },

  removeExclude: async (id, lineNumber, expectedPattern) => {
    const result = await window.api.invoke<IpcResult>(
      'repos:remove-exclude',
      id,
      lineNumber,
      expectedPattern
    )
    return { success: result.success, error: result.error }
  },

  listRepoDeployments: async (id) => {
    const result = await window.api.invoke<IpcResult<RepoDeploymentRow[]>>(
      'repos:list-deployments',
      id
    )
    if (result.success && result.data) return result.data
    return []
  }
}))
