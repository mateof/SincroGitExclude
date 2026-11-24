import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useFileStore } from '@/stores/file-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useRepoStore } from '@/stores/repo-store'
import { usePreferencesStore, type Preferences } from '@/stores/preferences-store'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { DashboardPage } from '@/pages/DashboardPage'
import { FileDetailPage } from '@/pages/FileDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { QuickSwitcher } from '@/components/kb/QuickSwitcher'
import { useKbStore } from '@/stores/kb-store'
import type { KbSemanticStatus, KbSyncReport } from '../../../../shared/kb/types'

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

  useEffect(() => {
    usePreferencesStore.getState().load()
    const unsubPreferences = window.api.on('preferences:changed', (preferences: unknown) => {
      usePreferencesStore.getState().receive(preferences as Preferences)
    })

    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubData = window.api.on('app:data-changed', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const { selectedFileId } = useUIStore.getState()
        useFileStore.getState().loadFiles()
        useFileStore.getState().loadTags()
        useRepoStore.getState().loadRepos()
        if (selectedFileId) useDeploymentStore.getState().loadDeployments(selectedFileId)
        useWatcherStore.getState().refreshChangedFileIds()
      }, 300)
    })

    const unsubKb = window.api.on('kb:changed', (payload: unknown) => {
      useKbStore.getState().receiveChanged(payload as { spaceId: string; paths: string[] })
    })
    const unsubKbSync = window.api.on('kb:sync-report', (payload: unknown) => {
      useKbStore.getState().receiveSyncReport(payload as { spaceId: string; report: KbSyncReport })
    })
    const unsubKbSemantic = window.api.on('kb:semantic-status', (payload: unknown) => {
      useKbStore.getState().receiveSemantic(payload as KbSemanticStatus)
    })

    return () => {
      if (timer) clearTimeout(timer)
      unsubPreferences()
      unsubData()
      unsubKb()
      unsubKbSync()
      unsubKbSemantic()
    }
  }, [])

  // Subscribe to watcher events from main process
  useEffect(() => {
    const unsubChange = window.api.on(
      'watcher:file-changed',
      async (deploymentId: unknown, computed?: unknown) => {
        const id = deploymentId as string
        let hasRealChanges: boolean
        if (typeof computed === 'boolean') {
          hasRealChanges = computed
          useDeploymentStore.getState().updateDeploymentStatus(id, { hasChanges: computed })
        } else {
          markChanged(id)
          hasRealChanges = await useDeploymentStore.getState().checkChanges(id)
        }
        if (hasRealChanges) markChanged(id)
        else clearChanged(id)
        refreshChangedFileIds()
      }
    )
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
      case 'knowledge':
        return <KnowledgePage />
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
        <main className={`flex-1 bg-background ${currentView === 'knowledge' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {currentView === 'knowledge' ? <div className="h-full overflow-y-auto">{renderContent()}</div> : renderContent()}
        </main>
      </div>
      <QuickSwitcher />
    </div>
  )
}
