import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns2, List, X, GitCommitHorizontal, Undo2 } from 'lucide-react'
import { parse } from 'diff2html'
import { DiffViewer } from './DiffViewer'

interface DiffModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unifiedDiff: string
  title?: string
  selectable?: boolean
  onCommitSelected?: (files: string[]) => void
  onDiscardSelected?: (files: string[]) => void
}

export function DiffModal({ open, onOpenChange, unifiedDiff, title, selectable, onCommitSelected, onDiscardSelected }: DiffModalProps) {
  const { t } = useTranslation('commits')
  const [format, setFormat] = useState<'side-by-side' | 'line-by-line'>('side-by-side')

  const allFileNames = useMemo(() => {
    if (!unifiedDiff || !unifiedDiff.trim()) return []
    const files = parse(unifiedDiff, { matching: 'lines' })
    return files.map((f) => f.newName || f.oldName || '')
  }, [unifiedDiff])

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (selectable && allFileNames.length > 0) {
      setSelectedFiles(new Set(allFileNames))
    }
  }, [allFileNames, selectable])

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
            {selectable && onDiscardSelected && (
              <button
                onClick={() => {
                  if (window.confirm(t('staging.discardConfirm'))) {
                    onDiscardSelected(Array.from(selectedFiles))
                  }
                }}
                disabled={selectedFiles.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mr-1"
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t('staging.discardSelected')} ({selectedFiles.size})
              </button>
            )}
            {selectable && onCommitSelected && (
              <button
                onClick={() => onCommitSelected(Array.from(selectedFiles))}
                disabled={selectedFiles.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mr-2"
              >
                <GitCommitHorizontal className="w-3.5 h-3.5" />
                {t('staging.commitSelected')} ({selectedFiles.size})
              </button>
            )}
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
          <DiffViewer
            unifiedDiff={unifiedDiff}
            format={format}
            selectable={selectable}
            selectedFiles={selectable ? selectedFiles : undefined}
            onSelectionChange={selectable ? setSelectedFiles : undefined}
          />
        </div>
      </div>
    </div>
  )
}
