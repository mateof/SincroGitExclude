import { useTranslation } from 'react-i18next'
import type { CommitInfo } from '@/types'
import { Eye, FileCode, Rocket, RotateCcw, Tag } from 'lucide-react'

interface CommitRowProps {
  commit: CommitInfo
  isCurrent: boolean
  isFirst: boolean
  isLast: boolean
  onCheckout: () => void
  onViewDiff: () => void
  onViewFile: () => void
  onNewDeployment?: () => void
}

export function CommitRow({ commit, isCurrent, isFirst, isLast, onCheckout, onViewDiff, onViewFile, onNewDeployment }: CommitRowProps) {
  const { t } = useTranslation('commits')

  const shortHash = commit.hash.substring(0, 7)
  const date = new Date(commit.date)
  const formattedDate = formatRelativeDate(date)

  return (
    <div className="relative flex items-start gap-3 py-2 pl-0 group">
      {/* Timeline dot */}
      <div
        className={`relative z-10 w-[23px] h-[23px] rounded-full border-2 flex items-center justify-center shrink-0 ${
          isCurrent
            ? 'border-primary bg-primary/20'
            : 'border-border bg-background group-hover:border-muted-foreground'
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full ${
            isCurrent ? 'bg-primary' : 'bg-border group-hover:bg-muted-foreground'
          }`}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2 mb-0.5">
          <code className="text-[11px] font-mono text-primary">{shortHash}</code>
          <span className="text-xs text-muted-foreground">{formattedDate}</span>
          {commit.tag && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-medium bg-primary/10 text-primary">
              <Tag className="w-2.5 h-2.5" />
              {commit.tag.split('/').pop()}
            </span>
          )}
        </div>
        <p className="text-sm text-foreground truncate">{commit.message}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5">
        <button
          onClick={onViewFile}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title={t('actions.viewFile')}
        >
          <FileCode className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onViewDiff}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title={t('actions.viewDiff')}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onCheckout}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title={t('actions.checkout')}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        {onNewDeployment && (
          <button
            onClick={onNewDeployment}
            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
            title={t('actions.deploy', { defaultValue: 'Deploy this commit' })}
          >
            <Rocket className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
