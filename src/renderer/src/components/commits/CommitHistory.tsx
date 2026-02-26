import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommitInfo, Deployment, IpcResult } from '@/types'
import { CommitRow } from './CommitRow'
import { GitBranch } from 'lucide-react'

interface CommitHistoryProps {
  deployment: Deployment
  onCheckout: (commit: CommitInfo) => void
  onViewDiff: (hash1: string, hash2?: string) => void
  onViewFile: (hash: string) => void
  onNewDeployment?: (commitHash: string) => void
}

export function CommitHistory({ deployment, onCheckout, onViewDiff, onViewFile, onNewDeployment }: CommitHistoryProps) {
  const { t } = useTranslation('commits')
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCommits()
  }, [deployment.id])

  const loadCommits = async () => {
    setLoading(true)
    const result = await window.api.invoke<IpcResult<CommitInfo[]>>(
      'commits:list',
      deployment.id
    )
    if (result.success && result.data) {
      setCommits(result.data)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-mono text-muted-foreground">{deployment.branchName}</span>
        <span className="text-xs text-muted-foreground">-</span>
        <span className="text-xs text-muted-foreground truncate">{deployment.repoPath.split(/[/\\]/).slice(-1)[0]}</span>
      </div>

      {commits.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t('messages.noCommits')}
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />

          <div className="space-y-0">
            {commits.map((commit, index) => {
              const isCurrent = deployment.currentCommitHash
                ? commit.hash === deployment.currentCommitHash
                : index === 0
              return (
              <CommitRow
                key={commit.hash}
                commit={commit}
                isCurrent={isCurrent}
                isFirst={index === 0}
                isLast={index === commits.length - 1}
                onCheckout={() => onCheckout(commit)}
                onViewDiff={() => {
                  if (index < commits.length - 1) {
                    onViewDiff(commits[index + 1].hash, commit.hash)
                  } else {
                    onViewDiff(commit.hash)
                  }
                }}
                onViewFile={() => onViewFile(commit.hash)}
                onNewDeployment={onNewDeployment ? () => onNewDeployment(commit.hash) : undefined}
              />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
