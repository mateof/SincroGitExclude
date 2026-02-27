import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcResult } from '@/types'
import { X, FolderSync, AlertTriangle, DatabaseZap, Sparkles, Info } from 'lucide-react'

type DataMigrationMode = 'keep' | 'transfer' | 'fresh'

interface DataDirChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDir: string
  targetHasData: boolean
  isReset: boolean
}

export function DataDirChangeDialog({
  open,
  onOpenChange,
  targetDir,
  targetHasData,
  isReset
}: DataDirChangeDialogProps) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [mode, setMode] = useState<DataMigrationMode>('transfer')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setMode(targetHasData ? 'keep' : 'transfer')
      setLoading(false)
    }
  }, [open, targetHasData])

  if (!open) return null

  const handleConfirm = async () => {
    setLoading(true)
    if (isReset) {
      await window.api.invoke<IpcResult>('app:reset-data-dir', mode)
    } else {
      await window.api.invoke<IpcResult>('app:change-data-dir', targetDir, mode)
    }
    setLoading(false)
  }

  const options: { mode: DataMigrationMode; icon: typeof FolderSync; labelKey: string; hintKey: string }[] = [
    ...(targetHasData
      ? [{ mode: 'keep' as const, icon: DatabaseZap, labelKey: 'modeKeep', hintKey: 'modeKeepHint' }]
      : []),
    { mode: 'transfer', icon: FolderSync, labelKey: 'modeTransfer', hintKey: 'modeTransferHint' },
    { mode: 'fresh', icon: Sparkles, labelKey: 'modeFresh', hintKey: 'modeFreshHint' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {isReset ? t('appData.changeDialog.resetTitle') : t('appData.changeDialog.title')}
            </h2>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target path */}
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1">{t('appData.changeDialog.newPath')}</p>
          <div className="px-3 py-2 bg-secondary/50 rounded-lg text-xs font-mono truncate" title={targetDir}>
            {targetDir}
          </div>
        </div>

        {/* Existing data badge */}
        {targetHasData && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-primary/5 border border-primary/20 rounded-lg">
            <Info className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs text-primary">{t('appData.changeDialog.existingDataDetected')}</span>
          </div>
        )}

        {/* Migration mode options */}
        <div className="space-y-2 mb-4">
          {options.map((opt) => {
            const active = mode === opt.mode
            const Icon = opt.icon
            return (
              <button
                key={opt.mode}
                onClick={() => setMode(opt.mode)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  active
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border bg-secondary/30 hover:bg-secondary/50'
                }`}
              >
                {/* Radio circle */}
                <div
                  className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    active ? 'border-primary' : 'border-muted-foreground/40'
                  }`}
                >
                  {active && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t(`appData.changeDialog.${opt.labelKey}`)}</div>
                  <div className="text-[10px] text-muted-foreground">{t(`appData.changeDialog.${opt.hintKey}`)}</div>
                </div>
              </button>
            )
          })}
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
