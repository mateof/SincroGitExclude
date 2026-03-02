import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parse, html as diff2htmlHtml } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import { ChevronDown, ChevronRight, CheckSquare, Square } from 'lucide-react'

interface DiffViewerProps {
  unifiedDiff: string
  format: 'side-by-side' | 'line-by-line'
  selectable?: boolean
  selectedFiles?: Set<string>
  onSelectionChange?: (files: Set<string>) => void
}

export function DiffViewer({ unifiedDiff, format, selectable, selectedFiles, onSelectionChange }: DiffViewerProps) {
  const { t } = useTranslation('commits')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const fileEntries = useMemo(() => {
    if (!unifiedDiff || unifiedDiff.trim() === '') return []
    const files = parse(unifiedDiff, { matching: 'lines' })
    return files.map((file) => ({
      name: file.newName || file.oldName || '',
      added: file.addedLines,
      deleted: file.deletedLines,
      isNew: file.isNew,
      isDeleted: file.isDeleted,
      isRename: file.isRename,
      oldName: file.oldName,
      html: diff2htmlHtml([file], {
        drawFileList: false,
        matching: 'lines',
        outputFormat: format,
        highlight: true
      })
    }))
  }, [unifiedDiff, format])

  const totalAdded = fileEntries.reduce((sum, f) => sum + f.added, 0)
  const totalDeleted = fileEntries.reduce((sum, f) => sum + f.deleted, 0)

  const toggleCollapse = (index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const toggleFileSelection = (name: string) => {
    if (!selectedFiles || !onSelectionChange) return
    const next = new Set(selectedFiles)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    onSelectionChange(next)
  }

  const allSelected = selectable && selectedFiles && fileEntries.length > 0 && fileEntries.every((e) => selectedFiles.has(e.name))
  const toggleAll = () => {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(fileEntries.map((e) => e.name)))
    }
  }

  if (fileEntries.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t('diff.noDiff')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
        {selectable && (
          <button
            onClick={toggleAll}
            className="text-xs text-primary hover:underline shrink-0"
          >
            {allSelected ? t('staging.deselectAll') : t('staging.selectAll')}
          </button>
        )}
        <span>{t('diff.filesChanged', { count: fileEntries.length })}</span>
        {totalAdded > 0 && <span className="text-green-400">+{totalAdded}</span>}
        {totalDeleted > 0 && <span className="text-red-400">-{totalDeleted}</span>}
        {selectable && selectedFiles && (
          <span className="ml-auto text-primary">
            {t('staging.selectedCount', { count: selectedFiles.size })}
          </span>
        )}
      </div>

      {/* Per-file cards */}
      {fileEntries.map((entry, index) => (
        <div key={index} className="border border-border rounded-lg overflow-hidden">
          {/* File header */}
          <div className="flex items-center bg-card hover:bg-secondary/50 transition-colors">
            {selectable && selectedFiles && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFileSelection(entry.name) }}
                className="pl-3 pr-1 py-2 shrink-0"
              >
                {selectedFiles.has(entry.name) ? (
                  <CheckSquare className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            )}
            <button
              onClick={() => toggleCollapse(index)}
              className="flex-1 flex items-center gap-2 px-3 py-2 text-left min-w-0"
            >
              {collapsed.has(index) ? (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs font-mono truncate">
                {entry.isRename ? `${entry.oldName} → ${entry.name}` : entry.name}
              </span>
              {entry.isNew && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">
                  {t('diff.newFile')}
                </span>
              )}
              {entry.isDeleted && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded">
                  {t('diff.deletedFile')}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2 text-[10px] shrink-0">
                {entry.added > 0 && <span className="text-green-400">+{entry.added}</span>}
                {entry.deleted > 0 && <span className="text-red-400">-{entry.deleted}</span>}
              </div>
            </button>
          </div>

          {/* Diff content */}
          {!collapsed.has(index) && (
            <div
              className="overflow-auto text-xs border-t border-border [&_.d2h-wrapper]:bg-transparent [&_.d2h-file-header]:hidden [&_.d2h-file-wrapper]:border-0 [&_.d2h-file-wrapper]:rounded-none [&_.d2h-file-wrapper]:m-0 [&_.d2h-code-linenumber]:text-muted-foreground [&_.d2h-code-line]:text-foreground"
              dangerouslySetInnerHTML={{ __html: entry.html }}
            />
          )}
        </div>
      ))}
    </div>
  )
}
