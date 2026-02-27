import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useFileStore } from '@/stores/file-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { DashboardPage } from '@/pages/DashboardPage'
import { FileDetailPage } from '@/pages/FileDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'

export function MainLayout() {
  const { currentView, selectedFileId, deselectFile } = useUIStore()
  const { files } = useFileStore()
  const { markChanged, markDeleted, refreshChangedFileIds } = useWatcherStore()

  // Auto-deselect if selected file no longer exists (e.g. after deletion)
  const fileExists = selectedFileId ? files.some((f) => f.id === selectedFileId) : false

  useEffect(() => {
    if (currentView === 'file-detail' && selectedFileId && !fileExists) {
      deselectFile()
    }
  }, [fileExists, currentView, selectedFileId])

  // Subscribe to watcher events from main process
  useEffect(() => {
    const unsubChange = window.api.on('watcher:file-changed', (deploymentId: unknown) => {
      markChanged(deploymentId as string)
      refreshChangedFileIds()
    })
    const unsubDelete = window.api.on('watcher:file-deleted', (deploymentId: unknown) => {
      markDeleted(deploymentId as string)
      refreshChangedFileIds()
    })

    return () => {
      unsubChange()
      unsubDelete()
    }
  }, [markChanged, markDeleted, refreshChangedFileIds])

  const renderContent = () => {
    switch (currentView) {
      case 'settings':
        return <SettingsPage />
      case 'file-detail':
        return selectedFileId && fileExists ? (
          <FileDetailPage fileId={selectedFileId} />
        ) : (
          <DashboardPage />
        )
      default:
        return <DashboardPage />
    }
  }

  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-background">
          {renderContent()}
        </main>
      </div>
    </div>
  )
}
