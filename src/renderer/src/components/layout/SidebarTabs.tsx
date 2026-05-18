import { useTranslation } from 'react-i18next'
import { Files, FolderGit2 } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'

export function SidebarTabs() {
  const { t } = useTranslation('repos')
  const { sidebarTab, setSidebarTab } = useUIStore()

  return (
    <div className="flex items-center gap-1 mb-2">
      <button
        onClick={() => setSidebarTab('files')}
        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
          sidebarTab === 'files'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        <Files className="w-3.5 h-3.5" />
        {t('tabs.files')}
      </button>
      <button
        onClick={() => setSidebarTab('repos')}
        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
          sidebarTab === 'repos'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        <FolderGit2 className="w-3.5 h-3.5" />
        {t('tabs.repos')}
      </button>
    </div>
  )
}
