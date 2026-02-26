import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWatcherStore } from '@/stores/watcher-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import type { Deployment, IpcResult, CommitInfo } from '@/types'
import { X, GitCommitHorizontal } from 'lucide-react'

interface CommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deployment: Deployment
  onCommitted?: () => void
}

export function CommitDialog({ open, onOpenChange, deployment, onCommitted }: CommitDialogProps) {
  const { t } = useTranslation('commits')
  const { t: tc } = useTranslation('common')
  const { clearChanged } = useWatcherStore()
  const { checkChanges } = useDeploymentStore()
  const [message, setMessage] = useState('')
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return

    setLoading(true)
    setError('')

    const result = await window.api.invoke<IpcResult<CommitInfo>>(
      'commits:create',
      deployment.id,
      message.trim(),
      tag.trim() || undefined
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
              disabled={!message.trim() || loading}
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
