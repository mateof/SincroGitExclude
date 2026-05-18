import { useUIStore } from '@/stores/ui-store'
import { SidebarTabs } from './SidebarTabs'
import { FilesSidebarPanel } from './FilesSidebarPanel'
import { ReposSidebarPanel } from './ReposSidebarPanel'

export function Sidebar() {
  const { sidebarOpen, sidebarTab } = useUIStore()

  if (!sidebarOpen) return null

  return (
    <aside className="w-64 border-r border-border flex flex-col bg-card/50 shrink-0">
      <div className="p-2 border-b border-border">
        <SidebarTabs />
      </div>
      {sidebarTab === 'files' ? <FilesSidebarPanel /> : <ReposSidebarPanel />}
    </aside>
  )
}
