import { useTranslation } from 'react-i18next'
import type { ExcludeEntry } from '@/types'
import { X, AlertTriangle } from 'lucide-react'

interface RemoveExcludeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: ExcludeEntry | null
  onConfirm: () => Promise<void>
}

export function RemoveExcludeConfirmDialog({
  open,
  onOpenChange,
  entry,
  onConfirm
}: RemoveExcludeConfirmDialogProps) {
  const { t } = useTranslation('repos')
  const { t: tc } = useTranslation('common')

  if (!open || !entry) return null

  const isLinked = entry.linkedDeployment !== null
  const body = isLinked
    ? t('exclude.removeBodyLinked', {
        file: entry.linkedDeployment!.fileName,
        path: entry.linkedDeployment!.fileRelativePath
      })
    : t('exclude.removeBodyPlain', { pattern: entry.pattern })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl p-5 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            {isLinked && <AlertTriangle className="w-4 h-4 text-warning" />}
            {t('exclude.removeTitle')}
          </h3>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground whitespace-pre-line mb-4">
          {body}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            {tc('actions.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
          >
            {t('exclude.removeConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
