import { useTranslation } from 'react-i18next'
import type { ExcludeEntry } from '@/types'
import { useUIStore } from '@/stores/ui-store'
import { X, Link2, FileText, Wrench, Globe, AlertTriangle } from 'lucide-react'

interface ExcludeEntryRowProps {
  entry: ExcludeEntry
  onRemove: (entry: ExcludeEntry) => void
}

export function ExcludeEntryRow({ entry, onRemove }: ExcludeEntryRowProps) {
  const { t } = useTranslation('repos')
  const { selectFile } = useUIStore()

  // Source classification
  let badge: React.ReactNode = null
  if (entry.linkedDeployment) {
    badge = (
      <button
        onClick={() => selectFile(entry.linkedDeployment!.fileId)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        title={entry.linkedDeployment.fileRelativePath}
      >
        <Link2 className="w-2.5 h-2.5" />
        {t('exclude.sourceManaged', { file: entry.linkedDeployment.fileName })}
      </button>
    )
  } else if (entry.managedByApp && entry.deploymentId === 'manual') {
    badge = (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-success/15 text-success">
        <Wrench className="w-2.5 h-2.5" />
        {t('exclude.sourceManual')}
      </span>
    )
  } else if (entry.managedByApp) {
    // managedByApp true but no linked deployment → stale marker
    badge = (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-warning/15 text-warning"
        title={t('exclude.sourceStaleHint')}
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        {t('exclude.sourceStale')}
      </span>
    )
  } else {
    badge = (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
        <Globe className="w-2.5 h-2.5" />
        {t('exclude.sourceExternal')}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/40 transition-colors group">
      <span className="text-[10px] text-muted-foreground font-mono w-8 shrink-0 text-right">
        {entry.lineNumber + 1}
      </span>
      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <code className="text-xs font-mono flex-1 truncate" title={entry.pattern}>
        {entry.pattern}
      </code>
      <div className="shrink-0">{badge}</div>
      <button
        onClick={() => onRemove(entry)}
        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
