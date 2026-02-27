import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DiffViewer } from '../diff/DiffViewer'
import type { Deployment, CommitInfo, IpcResult } from '@/types'
import { X, GitMerge, Loader2 } from 'lucide-react'

interface ApplyFromDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDeployment: Deployment
  allDeployments: Deployment[]
  onApplied: () => void
}

function formatDeploymentLabel(d: Deployment): string {
  const repo = d.repoPath.split(/[/\\]/).slice(-2).join('/')
  return `${repo} — ${d.fileRelativePath}`
}

function formatCommitLabel(c: CommitInfo): string {
  const hash = c.hash.substring(0, 7)
  const msg = c.message.length > 50 ? c.message.substring(0, 50) + '...' : c.message
  const date = new Date(c.date).toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  return `${hash} — ${msg} (${date})`
}

export function ApplyFromDialog({
  open,
  onOpenChange,
  targetDeployment,
  allDeployments,
  onApplied
}: ApplyFromDialogProps) {
  const { t } = useTranslation('deployments')
  const { t: tc } = useTranslation('common')

  const [selectedDeploymentId, setSelectedDeploymentId] = useState('')
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [selectedCommitHash, setSelectedCommitHash] = useState('')
  const [loadingCommits, setLoadingCommits] = useState(false)
  const [diffContent, setDiffContent] = useState('')
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  // Other active deployments (exclude the target)
  const sourceDeployments = allDeployments.filter(
    (d) => d.id !== targetDeployment.id && d.isActive
  )

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedDeploymentId('')
      setCommits([])
      setSelectedCommitHash('')
      setDiffContent('')
      setError('')
      setApplying(false)
    }
  }, [open])

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  const loadCommitsForDeployment = async (deploymentId: string) => {
    if (!deploymentId) {
      setCommits([])
      setSelectedCommitHash('')
      setDiffContent('')
      return
    }

    setLoadingCommits(true)
    const result = await window.api.invoke<IpcResult<CommitInfo[]>>(
      'commits:list',
      deploymentId
    )
    if (result.success && result.data) {
      setCommits(result.data)
      if (result.data.length > 0) {
        const latest = result.data[0].hash
        setSelectedCommitHash(latest)
        loadDiff(latest)
      }
    }
    setLoadingCommits(false)
  }

  const loadDiff = async (commitHash: string) => {
    if (!commitHash) {
      setDiffContent('')
      return
    }

    setLoadingDiff(true)
    setError('')
    const result = await window.api.invoke<IpcResult<string>>(
      'commits:cross-diff',
      targetDeployment.id,
      commitHash
    )
    if (result.success) {
      setDiffContent(result.data || '')
    } else {
      setError(result.error || 'Error loading diff')
    }
    setLoadingDiff(false)
  }

  const handleDeploymentChange = (deploymentId: string) => {
    setSelectedDeploymentId(deploymentId)
    setSelectedCommitHash('')
    setCommits([])
    setDiffContent('')
    if (deploymentId) {
      loadCommitsForDeployment(deploymentId)
    }
  }

  const handleCommitChange = (commitHash: string) => {
    setSelectedCommitHash(commitHash)
    loadDiff(commitHash)
  }

  const handleApply = async () => {
    if (!selectedCommitHash) return
    setApplying(true)
    setError('')

    const result = await window.api.invoke<IpcResult<unknown>>(
      'commits:apply-from',
      targetDeployment.id,
      selectedCommitHash
    )

    if (result.success) {
      onApplied()
      onOpenChange(false)
    } else {
      setError(result.error || 'Error applying changes')
    }
    setApplying(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-4xl max-h-[90vh] mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-primary" />
            <h2 className="text-sm font-semibold">{t('actions.applyFromTitle')}</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-lg hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Target info */}
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{tc('labels.target', { defaultValue: 'Target' })}:</span>{' '}
            {formatDeploymentLabel(targetDeployment)}
          </div>

          {/* Source deployment selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('actions.selectSourceDeployment')}
            </label>
            {sourceDeployments.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground bg-secondary rounded-lg border border-border">
                {t('actions.noOtherDeployments')}
              </div>
            ) : (
              <select
                value={selectedDeploymentId}
                onChange={(e) => handleDeploymentChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              >
                <option value="">—</option>
                {sourceDeployments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {formatDeploymentLabel(d)}
                    {d.description ? ` (${d.description})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Commit selector */}
          {selectedDeploymentId && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {t('actions.selectSourceCommit')}
              </label>
              {loadingCommits ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {tc('labels.loading')}
                </div>
              ) : commits.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground bg-secondary rounded-lg border border-border">
                  {tc('labels.noData')}
                </div>
              ) : (
                <select
                  value={selectedCommitHash}
                  onChange={(e) => handleCommitChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none font-mono"
                >
                  {commits.map((c) => (
                    <option key={c.hash} value={c.hash}>
                      {formatCommitLabel(c)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Diff preview */}
          {selectedCommitHash && (
            <div>
              {loadingDiff ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {tc('labels.loading')}
                </div>
              ) : diffContent ? (
                <DiffViewer unifiedDiff={diffContent} format="line-by-line" />
              ) : !error ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                  {t('actions.noDiffAvailable')}
                </div>
              ) : null}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 text-xs text-destructive bg-destructive/10 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
          >
            {tc('actions.cancel')}
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedCommitHash || applying || loadingDiff || (!diffContent && !error)}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {applying ? tc('labels.loading') : t('actions.applyChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}
