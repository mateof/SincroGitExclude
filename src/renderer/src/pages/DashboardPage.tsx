import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import type { IpcResult } from '@/types'
import { FileText, FolderGit2, GitCommitHorizontal } from 'lucide-react'

interface DeploymentStats {
  activeDeployments: number
  totalDeployments: number
  pendingChanges: number
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { files } = useFileStore()
  const [stats, setStats] = useState<DeploymentStats | null>(null)

  useEffect(() => {
    window.api
      .invoke<IpcResult<DeploymentStats>>('deployments:stats')
      .then((r) => {
        if (r.success && r.data) setStats(r.data)
      })
  }, [])

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">SincroGitExclude</h1>
        <p className="text-sm text-muted-foreground">
          {t('app.description')}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <span className="text-2xl font-bold">{files.length}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.managedFiles', { ns: 'common', defaultValue: 'Managed Files' })}
          </span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <FolderGit2 className="w-4 h-4 text-success" />
            </div>
            <span className="text-2xl font-bold">
              {stats ? stats.activeDeployments : 0}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.activeDeployments', { ns: 'common', defaultValue: 'Active Deployments' })}
          </span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
              <GitCommitHorizontal className="w-4 h-4 text-warning" />
            </div>
            <span className="text-2xl font-bold">
              {stats ? stats.pendingChanges : 0}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.pendingChanges', { ns: 'common', defaultValue: 'Pending Changes' })}
          </span>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {files.length === 0
            ? t('dashboard.getStarted', {
                ns: 'common',
                defaultValue: 'Create your first managed file to get started.'
              })
            : t('dashboard.selectFile', {
                ns: 'common',
                defaultValue: 'Select a file from the sidebar to view details.'
              })}
        </p>
      </div>
    </div>
  )
}
