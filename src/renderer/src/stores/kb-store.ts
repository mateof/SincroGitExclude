import { create } from 'zustand'
import type {
  KbNoteView,
  KbSemanticStatus,
  KbSpace,
  KbSyncReport,
  KbTreeNode
} from '../../../shared/kb/types'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

export async function kbCall<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await window.api.invoke<Envelope<T>>(channel, ...args)
  if (!result.success) throw new Error(result.error || `${channel} failed`)
  return result.data as T
}

interface KbStore {
  spaces: KbSpace[]
  loaded: boolean
  selectedSpaceId: string | null
  selectedPath: string | null
  pendingHeading: string | null
  trees: Record<string, KbTreeNode>
  expanded: Record<string, boolean>
  note: KbNoteView | null
  noteError: string | null
  loadingNote: boolean
  syncing: Record<string, boolean>
  semantic: KbSemanticStatus | null
  quickOpen: boolean
  showFiles: boolean
  error: string | null
  loadSpaces: () => Promise<void>
  loadTree: (spaceId: string) => Promise<void>
  selectSpace: (spaceId: string | null) => void
  openNote: (spaceId: string, path: string, heading?: string | null) => Promise<void>
  closeNote: () => void
  refreshNote: () => Promise<void>
  toggleFolder: (spaceId: string, path: string, open?: boolean) => void
  setQuickOpen: (open: boolean) => void
  setShowFiles: (show: boolean) => void
  syncNow: (spaceId: string) => Promise<KbSyncReport | null>
  loadSemantic: () => Promise<void>
  receiveChanged: (payload: { spaceId: string; paths: string[] }) => void
  receiveSyncReport: (payload: { spaceId: string; report: KbSyncReport }) => void
  receiveSemantic: (status: KbSemanticStatus) => void
  clearError: () => void
}

function readExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('kbExpanded') || '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useKbStore = create<KbStore>((set, get) => ({
  spaces: [],
  loaded: false,
  selectedSpaceId: localStorage.getItem('kbSpace'),
  selectedPath: null,
  pendingHeading: null,
  trees: {},
  expanded: readExpanded(),
  note: null,
  noteError: null,
  loadingNote: false,
  syncing: {},
  semantic: null,
  quickOpen: false,
  showFiles: localStorage.getItem('kbShowFiles') === '1',
  error: null,

  loadSpaces: async () => {
    try {
      const spaces = await kbCall<KbSpace[]>('kb:list-spaces')
      const current = get().selectedSpaceId
      const selected = spaces.some((s) => s.id === current) ? current : (spaces[0]?.id ?? null)
      set({ spaces, loaded: true, selectedSpaceId: selected })
      if (selected) await get().loadTree(selected)
    } catch (error) {
      set({ loaded: true, error: (error as Error).message })
    }
  },

  loadTree: async (spaceId) => {
    try {
      const tree = await kbCall<KbTreeNode>('kb:tree', spaceId, get().showFiles)
      set((s) => ({ trees: { ...s.trees, [spaceId]: tree } }))
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  selectSpace: (spaceId) => {
    if (spaceId) localStorage.setItem('kbSpace', spaceId)
    set({ selectedSpaceId: spaceId, selectedPath: null, note: null, noteError: null })
    if (spaceId && !get().trees[spaceId]) void get().loadTree(spaceId)
  },

  openNote: async (spaceId, path, heading = null) => {
    const expanded = { ...get().expanded }
    for (const folder of ancestorsOf(path)) expanded[`${spaceId}:${folder}`] = true
    localStorage.setItem('kbExpanded', JSON.stringify(expanded))
    localStorage.setItem('kbSpace', spaceId)
    set({ selectedSpaceId: spaceId, selectedPath: path, pendingHeading: heading, loadingNote: true, noteError: null, expanded })
    if (!get().trees[spaceId]) void get().loadTree(spaceId)
    try {
      const note = await kbCall<KbNoteView>('kb:note-view', spaceId, path)
      if (get().selectedPath === path && get().selectedSpaceId === spaceId) set({ note, loadingNote: false })
    } catch (error) {
      set({ note: null, noteError: (error as Error).message, loadingNote: false })
    }
  },

  closeNote: () => set({ selectedPath: null, note: null, noteError: null }),

  refreshNote: async () => {
    const { selectedSpaceId, selectedPath } = get()
    if (!selectedSpaceId || !selectedPath) return
    try {
      const note = await kbCall<KbNoteView>('kb:note-view', selectedSpaceId, selectedPath)
      if (get().selectedPath === selectedPath) set({ note, noteError: null })
    } catch (error) {
      set({ noteError: (error as Error).message })
    }
  },

  toggleFolder: (spaceId, path, open) => {
    const key = `${spaceId}:${path}`
    const expanded = { ...get().expanded, [key]: open ?? !get().expanded[key] }
    localStorage.setItem('kbExpanded', JSON.stringify(expanded))
    set({ expanded })
  },

  setQuickOpen: (open) => set({ quickOpen: open }),

  setShowFiles: (show) => {
    localStorage.setItem('kbShowFiles', show ? '1' : '0')
    set({ showFiles: show, trees: {} })
    const id = get().selectedSpaceId
    if (id) void get().loadTree(id)
  },

  syncNow: async (spaceId) => {
    set((s) => ({ syncing: { ...s.syncing, [spaceId]: true } }))
    try {
      const report = await kbCall<KbSyncReport>('kb:sync', spaceId)
      await get().loadSpaces()
      return report
    } catch (error) {
      set({ error: (error as Error).message })
      return null
    } finally {
      set((s) => ({ syncing: { ...s.syncing, [spaceId]: false } }))
    }
  },

  loadSemantic: async () => {
    try {
      set({ semantic: await kbCall<KbSemanticStatus>('kb:semantic-status') })
    } catch {
      set({ semantic: null })
    }
  },

  receiveChanged: ({ spaceId, paths }) => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      const state = get()
      void state.loadSpaces()
      if (state.trees[spaceId]) void state.loadTree(spaceId)
      if (state.selectedSpaceId === spaceId && state.selectedPath && (paths.length === 0 || paths.includes(state.selectedPath))) {
        void state.refreshNote()
      }
    }, 250)
  },

  receiveSyncReport: () => {
    void get().loadSpaces()
  },

  receiveSemantic: (status) => set({ semantic: status }),

  clearError: () => set({ error: null })
}))
