import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import { useUIStore } from '@/stores/ui-store'
import type { IpcResult } from '@/types'
import { DataDirChangeDialog } from '@/components/settings/DataDirChangeDialog'
import { UpdateChecker } from '@/components/settings/UpdateChecker'
import {
  Globe,
  Download,
  Upload,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Info,
  GitBranch,
  Tags,
  Trash2,
  Sun,
  Moon,
  Database,
  FolderArchive,
  RotateCcw,
  ExternalLink
} from 'lucide-react'

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { tags, loadTags, deleteTag, loadFiles } = useFileStore()
  const { theme, setTheme } = useUIStore()
  const [autoExclude, setAutoExclude] = useState(() => localStorage.getItem('autoExclude') !== 'false')
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [paths, setPaths] = useState<{ dbPath: string; filesDir: string; appDataDir: string; isCustom: boolean; appVersion: string } | null>(null)
  const [changeDirOpen, setChangeDirOpen] = useState(false)
  const [newDir, setNewDir] = useState('')
  const [confirmResetDir, setConfirmResetDir] = useState(false)

  useEffect(() => {
    loadTags()
    window.api.invoke<IpcResult<{ dbPath: string; filesDir: string; appDataDir: string; isCustom: boolean; appVersion: string }>>('app:get-paths').then((r) => {
      if (r.success && r.data) setPaths(r.data)
    })
  }, [loadTags])

  const handleDeleteTag = async (id: string) => {
    if (confirmDeleteTagId !== id) {
      setConfirmDeleteTagId(id)
      setTimeout(() => setConfirmDeleteTagId(null), 3000)
      return
    }
    await deleteTag(id)
    await loadFiles()
    setConfirmDeleteTagId(null)
  }
  const [importLoading, setImportLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('language', lang)
  }

  const handleAutoExcludeChange = (value: boolean) => {
    setAutoExclude(value)
    localStorage.setItem('autoExclude', String(value))
  }

  const handleChangeDir = async () => {
    const dir = await window.api.selectDirectory()
    if (!dir) return
    setNewDir(dir)
    setChangeDirOpen(true)
  }

  const handleResetDir = async () => {
    if (!confirmResetDir) {
      setConfirmResetDir(true)
      setTimeout(() => setConfirmResetDir(false), 3000)
      return
    }
    await window.api.invoke<IpcResult>('app:reset-data-dir')
  }

  const handleExport = async () => {
    const outputPath = await window.api.saveFile(
      `sincrogitexclude-backup-${new Date().toISOString().split('T')[0]}.zip`
    )
    if (!outputPath) return

    setExportLoading(true)
    setMessage(null)

    const result = await window.api.invoke<IpcResult>('export:all', outputPath)

    setExportLoading(false)
    if (result.success) {
      setMessage({ type: 'success', text: t('export.success') })
    } else {
      setMessage({ type: 'error', text: result.error || t('export.error') })
    }
  }

  const handleImport = async () => {
    const filePath = await window.api.selectFile([
      { name: 'ZIP Archive', extensions: ['zip'] }
    ])
    if (!filePath) return

    setImportLoading(true)
    setMessage(null)

    // First validate
    const validateResult = await window.api.invoke<IpcResult>('import:validate', filePath)
    if (!validateResult.success) {
      setImportLoading(false)
      setMessage({ type: 'error', text: validateResult.error || t('import.invalidArchive') })
      return
    }

    // Then execute
    const execResult = await window.api.invoke<IpcResult>('import:execute', filePath)

    setImportLoading(false)
    if (execResult.success) {
      setMessage({ type: 'success', text: t('import.success') })
      // Reload files
      window.location.reload()
    } else {
      setMessage({ type: 'error', text: execResult.error || t('import.error') })
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-6">{t('title')}</h1>

      <div className="space-y-6">
        {/* Theme */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            {theme === 'dark' ? (
              <Moon className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Sun className="w-4 h-4 text-muted-foreground" />
            )}
            <h3 className="text-sm font-semibold">{t('theme.label')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('theme.description')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setTheme('dark')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                theme === 'dark'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              {t('theme.dark')}
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                theme === 'light'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              {t('theme.light')}
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('language.label')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('language.description')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleLanguageChange('en')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                i18n.language === 'en'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
            >
              English
            </button>
            <button
              onClick={() => handleLanguageChange('es')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                i18n.language === 'es'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
            >
              Español
            </button>
          </div>
        </div>

        {/* Git Exclude */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('autoExclude.label')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('autoExclude.description')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleAutoExcludeChange(true)}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                autoExclude
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
            >
              {t('autoExclude.enabled')}
            </button>
            <button
              onClick={() => handleAutoExcludeChange(false)}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                !autoExclude
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
            >
              {t('autoExclude.disabled')}
            </button>
          </div>
        </div>

        {/* Application Data */}
        {paths && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t('appData.label')}</h3>
              {paths.isCustom && (
                <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">
                  {t('appData.customLocation')}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t('appData.description')}</p>

            <div className="space-y-2 mb-3">
              {/* Database path */}
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0">{t('appData.database')}:</span>
                <span className="text-xs font-mono truncate flex-1" title={paths.dbPath}>{paths.dbPath}</span>
                <button
                  onClick={() => window.api.invoke('app:open-path', paths.appDataDir)}
                  className="p-1 rounded hover:bg-secondary transition-colors shrink-0"
                  title={t('appData.openFolder')}
                >
                  <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              {/* Files path */}
              <div className="flex items-center gap-2">
                <FolderArchive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0">{t('appData.files')}:</span>
                <span className="text-xs font-mono truncate flex-1" title={paths.filesDir}>{paths.filesDir}</span>
                <button
                  onClick={() => window.api.invoke('app:open-path', paths.filesDir)}
                  className="p-1 rounded hover:bg-secondary transition-colors shrink-0"
                  title={t('appData.openFolder')}
                >
                  <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleChangeDir}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-muted transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t('appData.changeLocation')}
              </button>
              {paths.isCustom && (
                <button
                  onClick={handleResetDir}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                    confirmResetDir
                      ? 'bg-destructive text-destructive-foreground'
                      : 'bg-secondary hover:bg-muted'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {confirmResetDir ? t('appData.resetConfirm') : t('appData.resetLocation')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tags Management */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Tags className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('tags.label')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('tags.description')}</p>

          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t('tags.empty')}</p>
          ) : (
            <div className="space-y-1.5">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-lg group"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-sm flex-1">{tag.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {tag.fileCount === 1
                      ? t('tags.fileCount_one', { count: tag.fileCount })
                      : t('tags.fileCount_other', { count: tag.fileCount ?? 0 })}
                  </span>
                  <button
                    onClick={() => handleDeleteTag(tag.id)}
                    className={`p-1 rounded transition-colors shrink-0 ${
                      confirmDeleteTagId === tag.id
                        ? 'bg-destructive text-destructive-foreground'
                        : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                    }`}
                    title={tc('actions.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Export */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('export.label')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('export.description')}</p>
          <button
            onClick={handleExport}
            disabled={exportLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportLoading ? '...' : tc('actions.export')}
          </button>
        </div>

        {/* Import */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('import.label')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('import.description')}</p>
          <button
            onClick={handleImport}
            disabled={importLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {importLoading ? '...' : tc('actions.import')}
          </button>
        </div>

        {/* About */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('about.label')}</h3>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 mb-3">
            <p>{t('about.version')}: {paths?.appVersion ?? '...'}</p>
            <p>Electron + React + TypeScript</p>
            <a
              href="https://github.com/mateof/SincroGitExclude"
              onClick={(e) => {
                e.preventDefault()
                window.api.invoke('shell:open-external', 'https://github.com/mateof/SincroGitExclude')
              }}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {t('about.github')}
            </a>
          </div>
          {paths && <UpdateChecker currentVersion={paths.appVersion} />}
        </div>

        {/* Message */}
        {message && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg text-xs ${
              message.type === 'success'
                ? 'bg-success/10 text-success'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}
      </div>

      <DataDirChangeDialog
        open={changeDirOpen}
        onOpenChange={setChangeDirOpen}
        newDir={newDir}
      />
    </div>
  )
}
