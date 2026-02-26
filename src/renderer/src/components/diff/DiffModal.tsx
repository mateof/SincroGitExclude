import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns2, List, X } from 'lucide-react'
import { DiffViewer } from './DiffViewer'

interface DiffModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unifiedDiff: string
  title?: string
}

export function DiffModal({ open, onOpenChange, unifiedDiff, title }: DiffModalProps) {
  const { t } = useTranslation('commits')
  const [format, setFormat] = useState<'side-by-side' | 'line-by-line'>('side-by-side')

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-6xl max-h-[90vh] mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {title && <span className="text-sm font-medium truncate">{title}</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setFormat('side-by-side')}
              className={`p-1.5 rounded text-xs transition-colors ${
                format === 'side-by-side'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
              title={t('diff.sideBySide')}
            >
              <Columns2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setFormat('line-by-line')}
              className={`p-1.5 rounded text-xs transition-colors ${
                format === 'line-by-line'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
              title={t('diff.lineByLine')}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded text-muted-foreground hover:bg-secondary transition-colors ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 flex-1">
          <DiffViewer unifiedDiff={unifiedDiff} format={format} />
        </div>
      </div>
    </div>
  )
}
