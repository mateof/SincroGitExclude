import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import type { Deployment, IpcResult } from '@/types'
import {
  FolderGit2,
  FolderOpen,
  Shield,
  ShieldAlert,
  CircleDot,
  GitCommitHorizontal,
  History,
  Power,
  PowerOff,
  Trash2,
  ShieldCheck,
  ShieldX,
  ShieldEllipsis,
  Eye,
  Copy,
  FileCode
} from 'lucide-react'

interface DeploymentCardProps {
  deployment: Deployment
  onViewHistory: (deployment: Deployment) => void
  onCommit: (deployment: Deployment) => void
  onViewDiff: (deployment: Deployment) => void
  onViewFile: (deployment: Deployment) => void
  onNewDeployment: (deploymentId: string) => void
}

export function DeploymentCard({
  deployment,
  onViewHistory,
  onCommit,
  onViewDiff,
  onViewFile,
  onNewDeployment
}: DeploymentCardProps) {
  const { t } = useTranslation('deployments')
  const { t: tc } = useTranslation('common')
  const { deactivateDeployment, reactivateDeployment, deleteDeployment, checkExclude } =
    useDeploymentStore()
  const { changedDeployments } = useWatcherStore()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const hasWatcherChanges = changedDeployments.has(deployment.id)
  const hasChanges = deployment.hasChanges || hasWatcherChanges

  const handleToggleExclude = async () => {
    if (deployment.isExcluded) {
      await window.api.invoke<IpcResult>('exclude:remove', deployment.id)
    } else {
      await window.api.invoke<IpcResult>('exclude:add', deployment.id)
    }
    await checkExclude(deployment.id)
  }

  const handleDeactivate = async () => {
    await deactivateDeployment(deployment.id)
  }

  const handleReactivate = async () => {
    await reactivateDeployment(deployment.id)
  }

  const handleDeleteConfirm = async (diskOptions: Record<string, boolean>) => {
    await deleteDeployment(deployment.id, diskOptions[deployment.id] ?? false)
  }

  const handleOpenFolder = () => {
    const relativePath = deployment.fileRelativePath.replace(/^\/+/, '')
    const fullPath = [deployment.repoPath, relativePath].join('/')
    window.api.invoke('shell:show-in-folder', fullPath)
  }

  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        deployment.isActive
          ? 'border-border bg-card'
          : 'border-border/50 bg-card/50 opacity-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" title={deployment.repoPath}>
              {deployment.repoPath.split(/[/\\]/).slice(-2).join('/')}
            </div>
            <div className="text-xs text-muted-foreground truncate" title={deployment.fullPath}>
              {deployment.fileRelativePath}
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {deployment.isActive ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              {tc('status.active')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              {tc('status.inactive')}
            </span>
          )}
        </div>
      </div>

      {/* Indicators */}
      {deployment.isActive && (
        <div className="flex items-center gap-3 mb-3">
          {/* Exclude status */}
          <div className="flex items-center gap-1.5">
            {deployment.isExcluded ? (
              <>
                <Shield className="w-3.5 h-3.5 text-success" />
                <span className="text-[10px] text-success">{tc('status.excluded')}</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-warning" />
                <span className="text-[10px] text-warning">{tc('status.notExcluded')}</span>
              </>
            )}
          </div>

          {/* Global exclude info */}
          {deployment.isGloballyExcluded && (
            <div className="flex items-center gap-1.5">
              <ShieldEllipsis className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{tc('status.globallyExcluded')}</span>
            </div>
          )}

          {/* Changes indicator */}
          {hasChanges && (
            <div className="flex items-center gap-1.5">
              <CircleDot className="w-3.5 h-3.5 text-warning" />
              <span className="text-[10px] text-warning">{tc('status.hasChanges')}</span>
            </div>
          )}

          {!hasChanges && deployment.lastSyncedAt && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">{tc('status.synced')}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {deployment.isActive && (
          <>
            {/* Toggle exclude */}
            <button
              onClick={handleToggleExclude}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                deployment.isExcluded
                  ? 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                  : 'hover:bg-success/10 text-muted-foreground hover:text-success'
              }`}
              title={deployment.isExcluded ? t('actions.removeExclude') : t('actions.addExclude')}
            >
              {deployment.isExcluded ? (
                <ShieldX className="w-3.5 h-3.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
            </button>

            {/* View file */}
            <button
              onClick={() => onViewFile(deployment)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
            >
              <FileCode className="w-3.5 h-3.5" />
              {t('actions.viewFile')}
            </button>

            {/* View diff */}
            {hasChanges && (
              <button
                onClick={() => onViewDiff(deployment)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              >
                <Eye className="w-3.5 h-3.5" />
                {t('actions.viewDiff')}
              </button>
            )}

            {/* Commit */}
            <button
              onClick={() => onCommit(deployment)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                hasChanges
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'hover:bg-secondary text-muted-foreground'
              }`}
            >
              <GitCommitHorizontal className="w-3.5 h-3.5" />
              {t('actions.commit')}
            </button>

            {/* Open folder */}
            <button
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              title={t('actions.openFolder', { defaultValue: 'Open in explorer' })}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>

            {/* History */}
            <button
              onClick={() => onViewHistory(deployment)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
            >
              <History className="w-3.5 h-3.5" />
              {t('actions.history', { defaultValue: 'History' })}
            </button>

            {/* New deployment from this one */}
            <button
              onClick={() => onNewDeployment(deployment.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
              title={t('actions.newDeployment')}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>

            {/* Deactivate */}
            <button
              onClick={handleDeactivate}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-auto"
            >
              <PowerOff className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {!deployment.isActive && (
          <>
            {/* Reactivate */}
            <button
              onClick={handleReactivate}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-success/10 text-muted-foreground hover:text-success transition-colors"
            >
              <Power className="w-3.5 h-3.5" />
              {t('actions.reactivate')}
            </button>

            {/* Open folder */}
            <button
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              title={t('actions.openFolder', { defaultValue: 'Open in explorer' })}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>

            {/* History (even when inactive) */}
            <button
              onClick={() => onViewHistory(deployment)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
            >
              <History className="w-3.5 h-3.5" />
            </button>

            {/* Delete */}
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ml-auto hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        mode="deployment"
        deployments={[deployment]}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
