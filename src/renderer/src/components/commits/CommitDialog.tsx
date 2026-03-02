import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWatcherStore } from '@/stores/watcher-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import type { Deployment, IpcResult, CommitInfo, ChangedFileInfo } from '@/types'
import { X, GitCommitHorizontal, CheckSquare, Square, Loader2 } from 'lucide-react'

interface CommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deployment: Deployment
  onCommitted?: () => void
  isBundle?: boolean
  preSelectedFiles?: string[]
}

export function CommitDialog({ open, onOpenChange, deployment, onCommitted, isBundle, preSelectedFiles }: CommitDialogProps) {
  const { t } = useTranslation('commits')
  const { t: tc } = useTranslation('common')
  const { clearChanged } = useWatcherStore()
  const { checkChanges } = useDeploymentStore()
  const [message, setMessage] = useState('')
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Bundle file selection
  const [changedFiles, setChangedFiles] = useState<ChangedFileInfo[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = useState(false)

  // Load changed files when opening for bundles
  useEffect(() => {
    if (!open || !isBundle) return

    if (preSelectedFiles) {
      // Pre-selected from diff modal — no need to fetch
      setSelectedFiles(new Set(preSelectedFiles))
      setChangedFiles(preSelectedFiles.map((p) => ({ path: p, status: 'modified' as const, additions: 0, deletions: 0 })))
      return
    }

    // Fetch changed files from backend
    setLoadingFiles(true)
    window.api.invoke<IpcResult<ChangedFileInfo[]>>('commits:changed-files', deployment.id).then((result) => {
      if (result.success && result.data) {
        setChangedFiles(result.data)
        setSelectedFiles(new Set(result.data.map((f) => f.path)))
      }
      setLoadingFiles(false)
    })
  }, [open, isBundle, deployment.id, preSelectedFiles])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setMessage('')
      setTag('')
      setError('')
      setChangedFiles([])
      setSelectedFiles(new Set())
    }
  }, [open])

  if (!open) return null

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const allSelected = changedFiles.length > 0 && changedFiles.every((f) => selectedFiles.has(f.path))
  const toggleAll = () => {
    if (allSelected) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(changedFiles.map((f) => f.path)))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    if (isBundle && selectedFiles.size === 0) return

    setLoading(true)
    setError('')

    const filesToCommit = isBundle ? Array.from(selectedFiles) : undefined

    const result = await window.api.invoke<IpcResult<CommitInfo>>(
      'commits:create',
      deployment.id,
      message.trim(),
      tag.trim() || undefined,
      filesToCommit
    )

    setLoading(false)

    if (result.success) {
      clearChanged(deployment.id)
      await checkChanges(deployment.id)
      setMessage('')
      setTag('')
      onOpenChange(false)
      onCommitted?.()
    } else {
      setError(result.error || t('messages.commitError', { defaultValue: 'Failed to commit' }))
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'added':
        return <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">{t('staging.added')}</span>
      case 'deleted':
        return <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded">{t('staging.deleted')}</span>
      default:
        return <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-400 rounded">{t('staging.modified')}</span>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitCommitHorizontal className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t('createTitle')}</h2>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 text-xs text-muted-foreground">
          <span className="font-mono">{deployment.branchName}</span>
          <span className="mx-1.5">-</span>
          <span className="truncate">{deployment.fileRelativePath}</span>
        </div>

        {/* Bundle file list */}
        {isBundle && (
          <div className="mb-4">
            {loadingFiles ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('staging.loadingFiles')}
              </div>
            ) : changedFiles.length > 0 ? (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 border-b border-border">
                  <button
                    onClick={toggleAll}
                    className="text-xs text-primary hover:underline"
                  >
                    {allSelected ? t('staging.deselectAll') : t('staging.selectAll')}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {t('staging.selectedCount', { count: selectedFiles.size })}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {changedFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => toggleFile(file.path)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-secondary/50 transition-colors text-left"
                    >
                      {selectedFiles.has(file.path) ? (
                        <CheckSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs font-mono truncate flex-1">{file.path}</span>
                      {statusBadge(file.status)}
                      {(file.additions > 0 || file.deletions > 0) && (
                        <div className="flex items-center gap-1.5 text-[10px] shrink-0">
                          {file.additions > 0 && <span className="text-green-400">+{file.additions}</span>}
                          {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-3">
                {t('messages.noChanges')}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('fields.message')}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('fields.messagePlaceholder', { defaultValue: 'Describe what changed...' })}
              autoFocus
              rows={3}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('fields.tag')}{' '}
              <span className="text-muted-foreground/50">({tc('labels.optional', { defaultValue: 'optional' })})</span>
            </label>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="v1.0.0"
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>

          {error && (
            <div className="p-3 text-xs text-destructive bg-destructive/10 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
            >
              {tc('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={!message.trim() || loading || (isBundle && selectedFiles.size === 0)}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : t('actions.commit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
