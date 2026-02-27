import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { FileEditDialog } from '@/components/files/FileEditDialog'
import { DeploymentList, type CreateSource } from '@/components/deployments/DeploymentList'
import { CommitHistory } from '@/components/commits/CommitHistory'
import { CommitDialog } from '@/components/commits/CommitDialog'
import { CheckoutConfirm } from '@/components/commits/CheckoutConfirm'
import { DiffModal } from '@/components/diff/DiffModal'
import { FileContentModal, type FileContentEntry } from '@/components/diff/FileContentModal'
import { DeleteConfirmDialog } from '@/components/deployments/DeleteConfirmDialog'
import type { Deployment, CommitInfo, IpcResult } from '@/types'
import { Pencil, Trash2, ArrowLeft, FolderArchive, ChevronDown, ChevronRight } from 'lucide-react'

interface FileDetailPageProps {
  fileId: string
}

export function FileDetailPage({ fileId }: FileDetailPageProps) {
  const { t } = useTranslation('files')
  const { t: tc } = useTranslation('common')
  const { files, deleteFile, loadEntries } = useFileStore()
  const { deployments, loadDeployments } = useDeploymentStore()
  const { refreshChangedFileIds } = useWatcherStore()
  const file = files.find((f) => f.id === fileId)

  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Bundle entries
  const [bundleEntries, setBundleEntries] = useState<string[]>([])
  const [entriesExpanded, setEntriesExpanded] = useState(false)

  useEffect(() => {
    if (file?.type === 'bundle') {
      loadEntries(fileId).then(setBundleEntries)
    }
  }, [fileId, file?.type])

  // Tab state
  const [tab, setTab] = useState<'deployments' | 'history'>('deployments')

  // Create dialog state (lifted from DeploymentList)
  const [createSource, setCreateSource] = useState<CreateSource | null>(null)

  // History state
  const [historyDeployment, setHistoryDeployment] = useState<Deployment | null>(null)

  // Reset to deployments tab and clear history when switching files
  useEffect(() => {
    setTab('deployments')
    setHistoryDeployment(null)
    setCreateSource(null)
  }, [fileId])

  // Commit dialog state
  const [commitDeployment, setCommitDeployment] = useState<Deployment | null>(null)

  // Checkout dialog state
  const [checkoutDeployment, setCheckoutDeployment] = useState<Deployment | null>(null)
  const [checkoutCommit, setCheckoutCommit] = useState<CommitInfo | null>(null)

  // Diff modal state
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [diffContent, setDiffContent] = useState('')
  const [diffTitle, setDiffTitle] = useState('')

  // File content modal state
  const [fileModalOpen, setFileModalOpen] = useState(false)
  const [fileContentEntries, setFileContentEntries] = useState<FileContentEntry[]>([])
  const [fileContentTitle, setFileContentTitle] = useState('')

  if (!file) {
    return null
  }

  const handleDeleteConfirm = async (deploymentDiskOptions: Record<string, boolean>) => {
    await deleteFile(fileId, deploymentDiskOptions)
  }

  const handleViewHistory = (deployment: Deployment) => {
    setHistoryDeployment(deployment)
    setTab('history')
  }

  const handleCommit = (deployment: Deployment) => {
    setCommitDeployment(deployment)
  }

  const handleViewCurrentFile = async (deployment: Deployment) => {
    const result = await window.api.invoke<IpcResult<FileContentEntry[]>>(
      'commits:files-current',
      deployment.id
    )
    if (result.success && result.data) {
      setFileContentEntries(result.data)
      setFileContentTitle(deployment.fileRelativePath)
      setFileModalOpen(true)
    }
  }

  const handleViewDiff = async (deployment: Deployment) => {
    const result = await window.api.invoke<IpcResult<string>>(
      'commits:diff-working',
      deployment.id
    )
    if (result.success && result.data) {
      setDiffContent(result.data)
      setDiffTitle(`${deployment.fileRelativePath} - uncommitted changes`)
      setDiffModalOpen(true)
    }
  }

  const handleViewCommitDiff = async (hash1: string, hash2?: string) => {
    if (!historyDeployment) return
    const result = await window.api.invoke<IpcResult<string>>(
      'commits:diff',
      historyDeployment.id,
      hash1,
      hash2
    )
    if (result.success && result.data) {
      setDiffContent(result.data)
      const h1 = hash1.substring(0, 7)
      const h2 = hash2 ? hash2.substring(0, 7) : 'parent'
      setDiffTitle(`${h1} → ${h2}`)
      setDiffModalOpen(true)
    }
  }

  const handleViewFile = async (hash: string) => {
    if (!historyDeployment) return
    const result = await window.api.invoke<IpcResult<FileContentEntry[]>>(
      'commits:files-at',
      historyDeployment.id,
      hash
    )
    if (result.success && result.data) {
      setFileContentEntries(result.data)
      setFileContentTitle(`${historyDeployment.fileRelativePath} @ ${hash.substring(0, 7)}`)
      setFileModalOpen(true)
    }
  }

  const handleCheckout = (commit: CommitInfo) => {
    setCheckoutDeployment(historyDeployment)
    setCheckoutCommit(commit)
  }

  const handleCheckedOut = async () => {
    if (historyDeployment) {
      await loadDeployments(fileId)
    }
  }

  // Keep historyDeployment in sync with store after reload
  useEffect(() => {
    if (historyDeployment) {
      const updated = deployments.find((d) => d.id === historyDeployment.id)
      if (updated && updated.currentCommitHash !== historyDeployment.currentCommitHash) {
        setHistoryDeployment(updated)
      }
    }
  }, [deployments])

  const handleNewDeployment = (deploymentId: string, commitHash?: string) => {
    setCreateSource({ deploymentId, commitHash })
    setTab('deployments')
  }

  const handleCommitted = () => {
    loadDeployments(fileId)
    refreshChangedFileIds()
    if (historyDeployment) {
      // Refresh history if visible
      setHistoryDeployment({ ...historyDeployment })
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* File header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold">{file.name}</h1>
            <span className="px-2 py-0.5 text-xs bg-secondary rounded-full text-muted-foreground">
              {file.alias}
            </span>
            {file.type === 'bundle' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded-full">
                <FolderArchive className="w-3 h-3" />
                {t('bundle', { defaultValue: 'Bundle' })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {tc('labels.created', { defaultValue: 'Created' })}: {new Date(file.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEdit(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            {tc('actions.edit')}
          </button>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {tc('actions.delete')}
          </button>
        </div>
      </div>

      {/* Bundle entries */}
      {file.type === 'bundle' && bundleEntries.length > 0 && (
        <div className="mb-4 border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setEntriesExpanded(!entriesExpanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            {entriesExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {t('bundleEntries', { defaultValue: 'Bundle files' })} ({bundleEntries.length})
          </button>
          {entriesExpanded && (
            <div className="border-t border-border bg-secondary/30 px-3 py-2 space-y-0.5 max-h-48 overflow-y-auto">
              {bundleEntries.map((entry) => (
                <div key={entry} className="text-[11px] font-mono text-muted-foreground truncate" title={entry}>
                  {entry}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        <button
          onClick={() => {
            setTab('deployments')
            setHistoryDeployment(null)
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'deployments'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tc('tabs.deployments', { ns: 'deployments', defaultValue: 'Deployments' })}
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'history'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tc('tabs.history', { ns: 'commits', defaultValue: 'History' })}
        </button>
      </div>

      {/* Tab content */}
      {tab === 'deployments' && (
        <DeploymentList
          fileId={fileId}
          onViewHistory={handleViewHistory}
          onCommit={handleCommit}
          onViewDiff={handleViewDiff}
          onViewFile={handleViewCurrentFile}
          createSource={createSource}
          onCreateSourceChange={setCreateSource}
        />
      )}

      {tab === 'history' && (
        <div>
          {historyDeployment ? (
            <div className="space-y-4">
              <button
                onClick={() => { setHistoryDeployment(null); setTab('deployments') }}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {tc('actions.back')}
              </button>
              <CommitHistory
                deployment={historyDeployment}
                onCheckout={handleCheckout}
                onViewDiff={handleViewCommitDiff}
                onViewFile={handleViewFile}
                onNewDeployment={(commitHash) => handleNewDeployment(historyDeployment.id, commitHash)}
              />
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
              {tc('messages.selectDeployment', {
                ns: 'commits',
                defaultValue: 'Select a deployment from the Deployments tab to view its history'
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <DiffModal
        open={diffModalOpen}
        onOpenChange={setDiffModalOpen}
        unifiedDiff={diffContent}
        title={diffTitle}
      />

      <FileContentModal
        open={fileModalOpen}
        onOpenChange={setFileModalOpen}
        files={fileContentEntries}
        title={fileContentTitle}
      />

      {/* Dialogs */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        mode="file"
        fileName={file.name}
        deployments={deployments}
        onConfirm={handleDeleteConfirm}
      />

      <FileEditDialog open={showEdit} onOpenChange={setShowEdit} file={file} />

      {commitDeployment && (
        <CommitDialog
          open={!!commitDeployment}
          onOpenChange={(open) => !open && setCommitDeployment(null)}
          deployment={commitDeployment}
          onCommitted={handleCommitted}
        />
      )}

      {checkoutDeployment && checkoutCommit && (
        <CheckoutConfirm
          open={!!checkoutDeployment}
          onOpenChange={(open) => {
            if (!open) {
              setCheckoutDeployment(null)
              setCheckoutCommit(null)
            }
          }}
          deployment={checkoutDeployment}
          commit={checkoutCommit}
          onCheckedOut={handleCheckedOut}
        />
      )}
    </div>
  )
}
