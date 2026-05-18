import { useTranslation } from 'react-i18next'
import type { RepoDeploymentRow } from '@/types'
import { useUIStore } from '@/stores/ui-store'
import { FolderArchive, FileText, ArrowRight, Power, PowerOff } from 'lucide-react'
import { getFileIcon } from '@/lib/file-icons'

interface RepoDeploymentGroupProps {
  fileId: string
  fileName: string
  fileAlias: string
  fileType: 'file' | 'bundle'
  deployments: RepoDeploymentRow[]
}

export function RepoDeploymentGroup({
  fileId,
  fileName,
  fileAlias,
  fileType,
  deployments
}: RepoDeploymentGroupProps) {
  const { t } = useTranslation('repos')
  const { t: tc } = useTranslation('common')
  const { selectFile } = useUIStore()

  const iconInfo = fileType !== 'bundle' ? getFileIcon(fileName) : null
  const Icon = fileType === 'bundle' ? FolderArchive : (iconInfo?.icon ?? FileText)
  const iconColor =
    fileType === 'bundle'
      ? 'var(--color-primary)'
      : (iconInfo?.color ?? 'var(--color-muted-foreground)')

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* File header */}
      <button
        onClick={() => selectFile(fileId)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/30 hover:bg-secondary/60 transition-colors text-left"
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: iconColor }} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{fileName}</div>
          <div className="text-[10px] text-muted-foreground truncate">{fileAlias}</div>
        </div>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-muted-foreground bg-secondary">
          {deployments.length}
        </span>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {/* Deployments */}
      <div className="divide-y divide-border">
        {deployments.map((d) => (
          <div key={d.id} className="px-3 py-2 flex items-center gap-2">
            {d.isActive ? (
              <Power className="w-3 h-3 text-success shrink-0" />
            ) : (
              <PowerOff className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-mono truncate" title={d.fileRelativePath}>
                {d.fileRelativePath || '(root)'}
              </div>
              {d.description && (
                <div className="text-[10px] text-muted-foreground truncate">
                  {d.description}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                {d.lastSyncedAt
                  ? new Date(d.lastSyncedAt).toLocaleString()
                  : tc('status.notSynced', { defaultValue: 'Not synced' })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
