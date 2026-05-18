import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useFileStore } from '@/stores/file-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useRepoStore } from '@/stores/repo-store'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { DashboardPage } from '@/pages/DashboardPage'
import { FileDetailPage } from '@/pages/FileDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { RepoDetailPage } from '@/pages/RepoDetailPage'

export function MainLayout() {
  const { currentView, selectedFileId, selectedRepoId, deselectFile, deselectRepo } =
    useUIStore()
  const { files } = useFileStore()
  const { repos, loadRepos } = useRepoStore()
  const { markChanged, markDeleted, clearChanged, refreshChangedFileIds } = useWatcherStore()

  // Load repos once at app start so DeploymentCard's reverse-link has the data
  useEffect(() => {
    loadRepos()
  }, [loadRepos])

  // Auto-deselect if selected file no longer exists (e.g. after deletion)
  const fileExists = selectedFileId ? files.some((f) => f.id === selectedFileId) : false
  const repoExists = selectedRepoId ? repos.some((r) => r.id === selectedRepoId) : false

  useEffect(() => {
    if (currentView === 'file-detail' && selectedFileId && !fileExists) {
      deselectFile()
    }
  }, [fileExists, currentView, selectedFileId])

  useEffect(() => {
    if (currentView === 'repo-detail' && selectedRepoId && !repoExists && repos.length > 0) {
      deselectRepo()
    }
  }, [repoExists, currentView, selectedRepoId, repos.length])

  // Sync snapshot enabled state to main process on mount
  useEffect(() => {
    const enabled = localStorage.getItem('snapshotsEnabled') !== 'false'
    window.api.invoke('snapshots:set-enabled', enabled)
  }, [])

  // Subscribe to watcher events from main process
  useEffect(() => {
    const unsubChange = window.api.on('watcher:file-changed', async (deploymentId: unknown) => {
      const id = deploymentId as string
      markChanged(id)
      // Verify actual content diff via deployment store (updates hasChanges in-place)
      const hasRealChanges = await useDeploymentStore.getState().checkChanges(id)
      if (!hasRealChanges) {
        clearChanged(id)
      }
      refreshChangedFileIds()
    })
    const unsubDelete = window.api.on('watcher:file-deleted', (deploymentId: unknown) => {
      const id = deploymentId as string
      markDeleted(id)
      useDeploymentStore.getState().updateDeploymentStatus(id, { fileExists: false })
      refreshChangedFileIds()
    })

    return () => {
      unsubChange()
      unsubDelete()
    }
  }, [markChanged, markDeleted, clearChanged, refreshChangedFileIds])

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
      case 'repo-detail':
        return selectedRepoId ? (
          <RepoDetailPage repoId={selectedRepoId} />
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
