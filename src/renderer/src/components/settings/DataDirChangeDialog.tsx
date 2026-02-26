import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcResult } from '@/types'
import { X, FolderSync, AlertTriangle, Database, FolderArchive } from 'lucide-react'

interface DataDirChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newDir: string
}

export function DataDirChangeDialog({ open, onOpenChange, newDir }: DataDirChangeDialogProps) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [copyDb, setCopyDb] = useState(true)
  const [copyFiles, setCopyFiles] = useState(true)
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleConfirm = async () => {
    setLoading(true)
    await window.api.invoke<IpcResult>('app:change-data-dir', newDir, copyDb, copyFiles)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t('appData.changeDialog.title')}</h2>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New path */}
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1">{t('appData.changeDialog.newPath')}</p>
          <div className="px-3 py-2 bg-secondary/50 rounded-lg text-xs font-mono truncate" title={newDir}>
            {newDir}
          </div>
        </div>

        {/* Copy options */}
        <div className="space-y-3 mb-4">
          <button
            onClick={() => setCopyDb(!copyDb)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
              copyDb
                ? 'border-primary/50 bg-primary/5'
                : 'border-border bg-secondary/30'
            }`}
          >
            <Database className={`w-4 h-4 shrink-0 ${copyDb ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t('appData.changeDialog.copyDb')}</div>
              <div className="text-[10px] text-muted-foreground">{t('appData.changeDialog.copyDbHint')}</div>
            </div>
            <div
              className={`w-8 h-5 rounded-full transition-colors relative ${
                copyDb ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  copyDb ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </div>
          </button>

          <button
            onClick={() => setCopyFiles(!copyFiles)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
              copyFiles
                ? 'border-primary/50 bg-primary/5'
                : 'border-border bg-secondary/30'
            }`}
          >
            <FolderArchive className={`w-4 h-4 shrink-0 ${copyFiles ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t('appData.changeDialog.copyFiles')}</div>
              <div className="text-[10px] text-muted-foreground">{t('appData.changeDialog.copyFilesHint')}</div>
            </div>
            <div
              className={`w-8 h-5 rounded-full transition-colors relative ${
                copyFiles ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  copyFiles ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Restart warning */}
        <div className="flex items-start gap-3 p-3 bg-warning/10 rounded-lg mb-4">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning">{t('appData.changeDialog.restartWarning')}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
          >
            {tc('actions.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? '...' : t('appData.changeDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
