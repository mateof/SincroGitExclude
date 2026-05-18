import { create } from 'zustand'

type CurrentView = 'dashboard' | 'file-detail' | 'settings' | 'repo-detail'
type Theme = 'dark' | 'light'
type SidebarTab = 'files' | 'repos'

interface UIStore {
  currentView: CurrentView
  selectedFileId: string | null
  selectedRepoId: string | null
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  theme: Theme
  setCurrentView: (view: CurrentView) => void
  selectFile: (fileId: string) => void
  deselectFile: () => void
  selectRepo: (repoId: string) => void
  deselectRepo: () => void
  setSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: () => void
  setTheme: (theme: Theme) => void
}

export const useUIStore = create<UIStore>((set) => ({
  currentView: 'dashboard',
  selectedFileId: null,
  selectedRepoId: null,
  sidebarOpen: true,
  sidebarTab: (localStorage.getItem('sidebarTab') as SidebarTab) || 'files',
  theme: (localStorage.getItem('theme') as Theme) || 'dark',

  setCurrentView: (view) => set({ currentView: view }),

  selectFile: (fileId) => {
    localStorage.setItem('sidebarTab', 'files')
    set({
      selectedFileId: fileId,
      selectedRepoId: null,
      currentView: 'file-detail',
      sidebarTab: 'files'
    })
  },

  deselectFile: () =>
    set({ selectedFileId: null, currentView: 'dashboard' }),

  selectRepo: (repoId) =>
    set({ selectedRepoId: repoId, selectedFileId: null, currentView: 'repo-detail' }),

  deselectRepo: () =>
    set({ selectedRepoId: null, currentView: 'dashboard' }),

  setSidebarTab: (tab) => {
    localStorage.setItem('sidebarTab', tab)
    set({ sidebarTab: tab })
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    document.documentElement.className = theme
    set({ theme })
  }
}))
