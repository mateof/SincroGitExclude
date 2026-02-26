import { create } from 'zustand'
import type { ManagedFile, FileTag } from '../types'
import type { IpcResult } from '../types'

interface FileStore {
  files: ManagedFile[]
  tags: FileTag[]
  loading: boolean
  loadFiles: () => Promise<void>
  loadTags: () => Promise<void>
  createFile: (name: string, alias: string, tagIds?: string[]) => Promise<ManagedFile | null>
  createBundle: (
    name: string,
    alias: string,
    filePaths: string[],
    basePath: string,
    tagIds?: string[]
  ) => Promise<ManagedFile | null>
  updateFile: (id: string, data: { name?: string; alias?: string; useAutoIcon?: boolean }) => Promise<ManagedFile | null>
  deleteFile: (id: string, deploymentDiskOptions?: Record<string, boolean>) => Promise<boolean>
  createTag: (name: string, color: string) => Promise<FileTag | null>
  deleteTag: (id: string) => Promise<boolean>
  setFileTags: (fileId: string, tagIds: string[]) => Promise<boolean>
  loadEntries: (fileId: string) => Promise<string[]>
}

function mapTags(raw: unknown): FileTag[] {
  if (!Array.isArray(raw)) return []
  return raw.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    color: t.color as string
  }))
}

function mapFileRow(row: Record<string, unknown>): ManagedFile {
  return {
    id: row.id as string,
    name: row.name as string,
    alias: row.alias as string,
    type: (row.type as 'file' | 'bundle') || 'file',
    useAutoIcon: row.use_auto_icon !== 0,
    tags: mapTags(row.tags),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export const useFileStore = create<FileStore>((set) => ({
  files: [],
  tags: [],
  loading: false,

  loadFiles: async () => {
    set({ loading: true })
    const result = await window.api.invoke<IpcResult<Record<string, unknown>[]>>('files:list')
    if (result.success && result.data) {
      set({ files: result.data.map(mapFileRow) })
    }
    set({ loading: false })
  },

  loadTags: async () => {
    const result = await window.api.invoke<IpcResult<FileTag[]>>('tags:list')
    if (result.success && result.data) {
      set({ tags: result.data })
    }
  },

  createFile: async (name, alias, tagIds) => {
    const result = await window.api.invoke<IpcResult<Record<string, unknown>>>(
      'files:create',
      name,
      alias,
      tagIds
    )
    if (result.success && result.data) {
      const file = mapFileRow(result.data)
      set((s) => ({ files: [file, ...s.files] }))
      return file
    }
    return null
  },

  createBundle: async (name, alias, filePaths, basePath, tagIds) => {
    const result = await window.api.invoke<IpcResult<Record<string, unknown>>>(
      'files:create-bundle',
      name,
      alias,
      filePaths,
      basePath,
      tagIds
    )
    if (result.success && result.data) {
      const file = mapFileRow(result.data)
      set((s) => ({ files: [file, ...s.files] }))
      return file
    }
    return null
  },

  updateFile: async (id, data) => {
    const result = await window.api.invoke<IpcResult<Record<string, unknown>>>('files:update', id, data)
    if (result.success && result.data) {
      const file = mapFileRow(result.data)
      set((s) => ({
        files: s.files.map((f) => (f.id === id ? file : f))
      }))
      return file
    }
    return null
  },

  deleteFile: async (id, deploymentDiskOptions) => {
    // First delete each deployment with its disk option
    if (deploymentDiskOptions) {
      for (const [deploymentId, deleteFromDisk] of Object.entries(deploymentDiskOptions)) {
        await window.api.invoke<IpcResult>('deployments:delete', deploymentId, deleteFromDisk)
      }
    }
    const result = await window.api.invoke<IpcResult>('files:delete', id)
    if (result.success) {
      set((s) => ({ files: s.files.filter((f) => f.id !== id) }))
      return true
    }
    return false
  },

  createTag: async (name, color) => {
    const result = await window.api.invoke<IpcResult<FileTag>>('tags:create', name, color)
    if (result.success && result.data) {
      set((s) => ({ tags: [...s.tags, result.data!] }))
      return result.data
    }
    return null
  },

  deleteTag: async (id) => {
    const result = await window.api.invoke<IpcResult>('tags:delete', id)
    if (result.success) {
      set((s) => ({
        tags: s.tags.filter((t) => t.id !== id),
        files: s.files.map((f) => ({
          ...f,
          tags: f.tags.filter((t) => t.id !== id)
        }))
      }))
      return true
    }
    return false
  },

  setFileTags: async (fileId, tagIds) => {
    const result = await window.api.invoke<IpcResult>('files:set-tags', fileId, tagIds)
    if (result.success) {
      set((s) => ({
        files: s.files.map((f) => {
          if (f.id !== fileId) return f
          return {
            ...f,
            tags: s.tags.filter((t) => tagIds.includes(t.id))
          }
        })
      }))
      return true
    }
    return false
  },

  loadEntries: async (fileId) => {
    const result = await window.api.invoke<IpcResult<string[]>>('files:list-entries', fileId)
    if (result.success && result.data) {
      return result.data
    }
    return []
  }
}))
