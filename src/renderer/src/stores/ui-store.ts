import { create } from 'zustand'

type CurrentView = 'dashboard' | 'file-detail' | 'settings'
type Theme = 'dark' | 'light'

interface UIStore {
  currentView: CurrentView
  selectedFileId: string | null
  sidebarOpen: boolean
  theme: Theme
  setCurrentView: (view: CurrentView) => void
  selectFile: (fileId: string) => void
  deselectFile: () => void
  toggleSidebar: () => void
  setTheme: (theme: Theme) => void
}

export const useUIStore = create<UIStore>((set) => ({
  currentView: 'dashboard',
  selectedFileId: null,
  sidebarOpen: true,
  theme: (localStorage.getItem('theme') as Theme) || 'dark',

  setCurrentView: (view) => set({ currentView: view }),

  selectFile: (fileId) =>
    set({ selectedFileId: fileId, currentView: 'file-detail' }),

  deselectFile: () =>
    set({ selectedFileId: null, currentView: 'dashboard' }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    document.documentElement.className = theme
    set({ theme })
  }
}))
