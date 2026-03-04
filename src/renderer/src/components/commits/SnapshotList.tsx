import { useTranslation } from 'react-i18next'
import type { SnapshotInfo } from '@/types'
import { Camera, Eye, RotateCcw, FolderOpen } from 'lucide-react'

interface SnapshotListProps {
  snapshots: SnapshotInfo[]
  onView: (snapshotId: string) => void
  onApply: (snapshotId: string) => void
  onDeploy: (snapshotId: string) => void
}

export function SnapshotList({ snapshots, onView, onApply, onDeploy }: SnapshotListProps) {
  const { t } = useTranslation('commits')

  if (snapshots.length === 0) return null

  return (
    <div className="ml-[11px] pl-6 border-l border-dashed border-primary/30">
      <div className="space-y-0">
        {snapshots.map((snap) => {
          const date = new Date(snap.createdAt + 'Z')
          const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

          return (
            <div key={snap.id} className="relative flex items-center gap-2 py-1.5 group">
              {/* Dot */}
              <div className="relative z-10 w-[15px] h-[15px] rounded-full border border-dashed border-primary/40 flex items-center justify-center shrink-0 bg-background">
                <Camera className="w-2 h-2 text-primary/60" />
              </div>

              {/* Content */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-[11px] font-mono text-muted-foreground">{timeStr}</span>
                <span className="text-[10px] text-muted-foreground">
                  {snap.fileCount} {snap.fileCount === 1 ? 'file' : 'files'}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => onView(snap.id)}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title={t('snapshots.view')}
                >
                  <Eye className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onApply(snap.id)}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title={t('snapshots.apply')}
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onDeploy(snap.id)}
                  className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  title={t('snapshots.deploy')}
                >
                  <FolderOpen className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
