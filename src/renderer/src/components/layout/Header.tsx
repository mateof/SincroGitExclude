import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/ui-store'
import { Settings, PanelLeftClose, PanelLeft, Globe } from 'lucide-react'

export function Header() {
  const { t, i18n } = useTranslation()
  const { currentView, setCurrentView, sidebarOpen, toggleSidebar, deselectFile } = useUIStore()

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'es' : 'en'
    i18n.changeLanguage(newLang)
    localStorage.setItem('language', newLang)
  }

  return (
    <header className="h-12 border-b border-border flex items-center justify-between px-4 bg-card shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-4 h-4 text-muted-foreground" />
          ) : (
            <PanelLeft className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={deselectFile}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">S</span>
          </div>
          <h1 className="text-sm font-semibold">SincroGitExclude</h1>
        </button>
      </div>

      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={toggleLanguage}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-secondary transition-colors text-xs text-muted-foreground"
        >
          <Globe className="w-3.5 h-3.5" />
          {i18n.language.toUpperCase()}
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`p-1.5 rounded-md transition-colors ${
            currentView === 'settings'
              ? 'bg-secondary text-foreground'
              : 'hover:bg-secondary text-muted-foreground'
          }`}
          title={t('settings.title', { ns: 'settings' })}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
