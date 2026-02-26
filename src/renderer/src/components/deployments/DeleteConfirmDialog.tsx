import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Deployment } from '@/types'
import { X, Trash2, AlertTriangle, HardDrive, FolderGit2 } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'file' | 'deployment'
  fileName?: string
  deployments: Deployment[]
  onConfirm: (deploymentDiskOptions: Record<string, boolean>) => void
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  mode,
  fileName,
  deployments,
  onConfirm
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation('deployments')
  const { t: tc } = useTranslation('common')
  const { t: tf } = useTranslation('files')
  const [diskOptions, setDiskOptions] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      const initial: Record<string, boolean> = {}
      for (const d of deployments) {
        initial[d.id] = false
      }
      setDiskOptions(initial)
      setLoading(false)
    }
  }, [open, deployments])

  if (!open) return null

  const toggleDisk = (id: string) => {
    setDiskOptions((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm(diskOptions)
    setLoading(false)
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onOpenChange(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-destructive" />
            <h2 className="text-lg font-semibold">
              {mode === 'file' ? tf('delete.title') : t('delete.title')}
            </h2>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-3 p-3 bg-warning/10 rounded-lg mb-4">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning">
            {mode === 'file' ? tf('delete.warning') : t('delete.warning')}
          </p>
        </div>

        {/* File name (for file mode) */}
        {mode === 'file' && fileName && (
          <div className="mb-4 text-sm">
            <span className="text-muted-foreground">{tc('labels.name')}:</span>{' '}
            <span className="font-medium">{fileName}</span>
          </div>
        )}

        {/* Deployments list with disk options */}
        {deployments.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-2">
              {mode === 'file' ? tf('delete.deploymentsHint') : t('delete.diskHint')}
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {deployments.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-secondary/30"
                >
                  <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate" title={d.repoPath}>
                      {d.repoPath.split(/[/\\]/).slice(-2).join('/')}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {d.fileRelativePath}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleDisk(d.id)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors shrink-0 ${
                      diskOptions[d.id]
                        ? 'bg-destructive/15 text-destructive border border-destructive/30'
                        : 'bg-secondary text-muted-foreground border border-border hover:border-destructive/30 hover:text-destructive'
                    }`}
                    title={
                      diskOptions[d.id]
                        ? tc('delete.willDeleteFromDisk')
                        : tc('delete.keepOnDisk')
                    }
                  >
                    <HardDrive className="w-3 h-3" />
                    {diskOptions[d.id]
                      ? tc('delete.deleteFromDisk')
                      : tc('delete.keepOnDisk')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
            className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {loading ? '...' : tc('actions.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
