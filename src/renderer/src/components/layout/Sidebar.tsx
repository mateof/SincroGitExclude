import { useUIStore } from '@/stores/ui-store'
import { ResizableAside } from './ResizableAside'
import { SidebarTabs } from './SidebarTabs'
import { FilesSidebarPanel } from './FilesSidebarPanel'
import { ReposSidebarPanel } from './ReposSidebarPanel'
import { KnowledgeSidebarPanel } from '@/components/kb/KnowledgeSidebarPanel'

export function Sidebar() {
  const { sidebarOpen, sidebarTab } = useUIStore()

  if (!sidebarOpen) return null

  return (
    <ResizableAside>
      <div className="p-2 border-b border-border">
        <SidebarTabs />
      </div>
      {sidebarTab === 'files' ? (
        <FilesSidebarPanel />
      ) : sidebarTab === 'repos' ? (
        <ReposSidebarPanel />
      ) : (
        <KnowledgeSidebarPanel />
      )}
    </ResizableAside>
  )
}
