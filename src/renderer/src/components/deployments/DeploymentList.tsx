import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentStore } from '@/stores/deployment-store'
import type { Deployment } from '@/types'
import { DeploymentCard } from './DeploymentCard'
import { DeploymentCreateDialog } from './DeploymentCreateDialog'
import { Plus } from 'lucide-react'

export interface CreateSource {
  deploymentId?: string
  commitHash?: string
}

interface DeploymentListProps {
  fileId: string
  onViewHistory: (deployment: Deployment) => void
  onCommit: (deployment: Deployment) => void
  onViewDiff: (deployment: Deployment) => void
  onViewFile: (deployment: Deployment) => void
  createSource: CreateSource | null
  onCreateSourceChange: (source: CreateSource | null) => void
}

export function DeploymentList({
  fileId,
  onViewHistory,
  onCommit,
  onViewDiff,
  onViewFile,
  createSource,
  onCreateSourceChange
}: DeploymentListProps) {
  const { t } = useTranslation('deployments')
  const { deployments, loading, loadDeployments } = useDeploymentStore()

  useEffect(() => {
    loadDeployments(fileId)
  }, [fileId, loadDeployments])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <button
          onClick={() => onCreateSourceChange({})}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('createTitle')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
      ) : deployments.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t('messages.noDeployments')}
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((d) => (
            <DeploymentCard
              key={d.id}
              deployment={d}
              onViewHistory={onViewHistory}
              onCommit={onCommit}
              onViewDiff={onViewDiff}
              onViewFile={onViewFile}
              onNewDeployment={(deploymentId) => onCreateSourceChange({ deploymentId })}
            />
          ))}
        </div>
      )}

      <DeploymentCreateDialog
        open={createSource !== null}
        onOpenChange={(open) => { if (!open) onCreateSourceChange(null) }}
        fileId={fileId}
        sourceDeploymentId={createSource?.deploymentId}
        sourceCommitHash={createSource?.commitHash}
      />
    </div>
  )
}
