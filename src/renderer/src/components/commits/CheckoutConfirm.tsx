import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommitInfo, Deployment, IpcResult } from '@/types'
import { X, RotateCcw, AlertTriangle } from 'lucide-react'

interface CheckoutConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deployment: Deployment
  commit: CommitInfo
  onCheckedOut?: () => void
}

export function CheckoutConfirm({
  open,
  onOpenChange,
  deployment,
  commit,
  onCheckedOut
}: CheckoutConfirmProps) {
  const { t } = useTranslation('commits')
  const { t: tc } = useTranslation('common')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleCheckout = async () => {
    setLoading(true)
    const result = await window.api.invoke<IpcResult>(
      'commits:checkout',
      deployment.id,
      commit.hash
    )
    setLoading(false)

    if (result.success) {
      onOpenChange(false)
      onCheckedOut?.()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-warning" />
            <h2 className="text-lg font-semibold">{t('actions.checkout')}</h2>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-3 p-3 bg-warning/10 rounded-lg mb-4">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning">
            {t('messages.checkoutConfirm')}
          </p>
        </div>

        <div className="space-y-2 mb-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('fields.commitLabel', { defaultValue: 'Commit' })}:</span>
            <code className="text-xs font-mono text-primary">{commit.hash.substring(0, 7)}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('fields.message')}:</span>
            <span className="truncate">{commit.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{tc('labels.path', { defaultValue: 'Path' })}:</span>
            <span className="text-xs truncate">{deployment.fullPath || deployment.fileRelativePath}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
          >
            {tc('actions.cancel')}
          </button>
          <button
            onClick={handleCheckout}
            disabled={loading}
            className="px-4 py-2 text-sm bg-warning text-background rounded-lg hover:bg-warning/90 disabled:opacity-50 transition-colors"
          >
            {loading ? '...' : t('actions.checkout')}
          </button>
        </div>
      </div>
    </div>
  )
}
