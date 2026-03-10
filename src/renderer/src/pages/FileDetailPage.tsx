import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { useUIStore } from '@/stores/ui-store'
import { FileEditDialog } from '@/components/files/FileEditDialog'
import { DeploymentList, type CreateSource } from '@/components/deployments/DeploymentList'
import { CommitHistory } from '@/components/commits/CommitHistory'
import { CommitDialog } from '@/components/commits/CommitDialog'
import { CheckoutConfirm } from '@/components/commits/CheckoutConfirm'
import { DiffModal } from '@/components/diff/DiffModal'
import { FileContentModal, type FileContentEntry } from '@/components/diff/FileContentModal'
import { DeleteConfirmDialog } from '@/components/deployments/DeleteConfirmDialog'
import { ApplyFromDialog } from '@/components/deployments/ApplyFromDialog'
import { PartialDeployDialog } from '@/components/deployments/PartialDeployDialog'
import type { Deployment, CommitInfo, IpcResult } from '@/types'
import { Pencil, Trash2, ArrowLeft, FolderArchive, HardDrive, GitBranch } from 'lucide-react'

interface FileDetailPageProps {
  fileId: string
}

export function FileDetailPage({ fileId }: FileDetailPageProps) {
  const { t } = useTranslation('files')
  const { t: tc } = useTranslation('common')
  const { files, deleteFile, loadEntries } = useFileStore()
  const { deployments, loadDeployments } = useDeploymentStore()
  const { refreshChangedFileIds } = useWatcherStore()
  const { selectFile } = useUIStore()
  const file = files.find((f) => f.id === fileId)

  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Bundle entries
  const [bundleEntries, setBundleEntries] = useState<string[]>([])

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
  const [diffDeployment, setDiffDeployment] = useState<Deployment | null>(null)
  const [diffIsWorking, setDiffIsWorking] = useState(false)

  // Pre-selected files from diff modal for commit
  const [preSelectedFiles, setPreSelectedFiles] = useState<string[] | undefined>(undefined)

  // File content modal state
  const [fileModalOpen, setFileModalOpen] = useState(false)
  const [fileContentEntries, setFileContentEntries] = useState<FileContentEntry[]>([])
  const [fileContentTitle, setFileContentTitle] = useState('')
  const [fileContentCommitHash, setFileContentCommitHash] = useState<string | null>(null)

  // Apply from dialog state
  const [applyFromDeployment, setApplyFromDeployment] = useState<Deployment | null>(null)

  // Partial deploy dialog state
  const [partialDeployment, setPartialDeployment] = useState<Deployment | null>(null)
  const [partialCommitHash, setPartialCommitHash] = useState<string | undefined>(undefined)

  // Unified remove file dialog state
  const [removeFileEntry, setRemoveFileEntry] = useState<string | null>(null)
  const [removeFileDeployment, setRemoveFileDeployment] = useState<Deployment | null>(null)

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
      setFileContentCommitHash(null)
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
      setDiffDeployment(deployment)
      setDiffIsWorking(true)
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
      setDiffDeployment(null)
      setDiffIsWorking(false)
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
      setFileContentCommitHash(hash)
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

  const handleCommitFromDiff = (files: string[]) => {
    if (!diffDeployment) return
    setDiffModalOpen(false)
    setPreSelectedFiles(files)
    setCommitDeployment(diffDeployment)
  }

  const handleDiscardFromDiff = async (files: string[]) => {
    if (!diffDeployment) return
    const result = await window.api.invoke<IpcResult>(
      'commits:discard-files',
      diffDeployment.id,
      files
    )
    if (result.success) {
      setDiffModalOpen(false)
      await loadDeployments(fileId)
      refreshChangedFileIds()
    }
  }

  const handleCommitted = () => {
    loadDeployments(fileId)
    refreshChangedFileIds()
    if (historyDeployment) {
      // Refresh history if visible
      setHistoryDeployment({ ...historyDeployment })
    }
  }

  const handleApplyFrom = (deployment: Deployment) => {
    setApplyFromDeployment(deployment)
  }

  const handleApplied = () => {
    loadDeployments(fileId)
    refreshChangedFileIds()
    setApplyFromDeployment(null)
  }

  const handlePartialDeploy = (deployment: Deployment, commitHash?: string) => {
    setPartialDeployment(deployment)
    setPartialCommitHash(commitHash)
  }

  const handlePartialCreated = (newFileId: string) => {
    setPartialDeployment(null)
    setPartialCommitHash(undefined)
    selectFile(newFileId)
  }

  const handleExtractFromCommit = (commitHash: string) => {
    if (historyDeployment) {
      handlePartialDeploy(historyDeployment, commitHash)
    }
  }

  const handleViewSnapshot = async (snapshotId: string) => {
    const result = await window.api.invoke<IpcResult<FileContentEntry[]>>('snapshots:files', snapshotId)
    if (result.success && result.data) {
      setFileContentEntries(result.data)
      setFileContentTitle(`Snapshot ${snapshotId.substring(0, 8)}`)
      setFileContentCommitHash(null)
      setFileModalOpen(true)
    }
  }

  const handleApplySnapshot = async (snapshotId: string) => {
    if (!confirm(tc('snapshots.applyConfirm', { ns: 'commits', defaultValue: 'Apply this snapshot? The current file content will be overwritten.' }))) return
    const result = await window.api.invoke<IpcResult>('snapshots:apply', snapshotId)
    if (result.success) {
      await loadDeployments(fileId)
      refreshChangedFileIds()
    }
  }

  const handleRestoreFileFromCommit = async (filePath: string) => {
    if (!historyDeployment || !fileContentCommitHash) return
    const result = await window.api.invoke<IpcResult>(
      'commits:restore-files',
      historyDeployment.id,
      fileContentCommitHash,
      [filePath]
    )
    if (result.success) {
      refreshChangedFileIds()
    }
  }

  const handleAddFilesToBundle = async (deployment: Deployment) => {
    const deployBasePath = `${deployment.repoPath}/${deployment.fileRelativePath}`

    const selectResult = await window.api.invoke<IpcResult<{
      type: string
      filePaths?: string[]
      filePath?: string
      basePath?: string
    }>>('dialog:select-items', deployBasePath)
    if (!selectResult?.success || !selectResult.data) return

    const data = selectResult.data
    let filePaths: string[]

    if (data.type === 'bundle' && data.filePaths) {
      filePaths = data.filePaths
    } else if (data.type === 'file' && data.filePath) {
      filePaths = [data.filePath]
    } else {
      return
    }

    const normalizedBase = deployBasePath.replace(/\\/g, '/')
    const validPaths = filePaths.filter((fp) => {
      const normalized = fp.replace(/\\/g, '/')
      return normalized.startsWith(normalizedBase + '/') || normalized === normalizedBase
    })
    if (validPaths.length === 0) {
      alert(t('addFilesOutside'))
      return
    }

    const result = await window.api.invoke<IpcResult<string[]>>(
      'files:add-to-bundle',
      fileId,
      validPaths,
      deployBasePath
    )
    if (result.success) {
      const entries = await loadEntries(fileId)
      setBundleEntries(entries)
    }
  }

  const handleRemoveFile = (deployment: Deployment, entry: string) => {
    if (bundleEntries.length <= 1) return
    setRemoveFileEntry(entry)
    setRemoveFileDeployment(deployment)
  }

  const closeRemoveDialog = () => {
    setRemoveFileEntry(null)
    setRemoveFileDeployment(null)
  }

  const confirmDeleteFromDisk = async () => {
    if (!removeFileEntry || !removeFileDeployment) return
    const result = await window.api.invoke<IpcResult<string[]>>(
      'files:remove-from-deployment',
      removeFileDeployment.id,
      [removeFileEntry]
    )
    closeRemoveDialog()
    if (result.success) {
      refreshChangedFileIds()
      await loadDeployments(fileId)
    }
  }

  const confirmStopSyncing = async (deleteFromDisk: boolean) => {
    if (!removeFileEntry) return
    const result = await window.api.invoke<IpcResult<string[]>>(
      'files:remove-from-bundle',
      fileId,
      [removeFileEntry],
      deleteFromDisk
    )
    closeRemoveDialog()
    if (result.success) {
      const entries = await loadEntries(fileId)
      setBundleEntries(entries)
      refreshChangedFileIds()
      await loadDeployments(fileId)
    }
  }

  const handleDeploySnapshot = async (snapshotId: string) => {
    const path = await window.api.selectDirectory()
    if (!path) return
    const result = await window.api.invoke<IpcResult<{ deploymentId: string }>>('snapshots:deploy', snapshotId, path)
    if (result.success) {
      await loadDeployments(fileId)
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
          isBundle={file.type === 'bundle'}
          onViewHistory={handleViewHistory}
          onCommit={handleCommit}
          onViewDiff={handleViewDiff}
          onViewFile={handleViewCurrentFile}
          onApplyFrom={handleApplyFrom}
          onPartialDeploy={file.type === 'bundle' ? handlePartialDeploy : undefined}
          onAddToBundle={file.type === 'bundle' ? handleAddFilesToBundle : undefined}
          bundleEntries={file.type === 'bundle' ? bundleEntries : undefined}
          onRemoveFile={file.type === 'bundle' ? handleRemoveFile : undefined}
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
                onExtractFiles={file.type === 'bundle' ? handleExtractFromCommit : undefined}
                onViewSnapshot={handleViewSnapshot}
                onApplySnapshot={handleApplySnapshot}
                onDeploySnapshot={handleDeploySnapshot}
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
        selectable={diffIsWorking && file.type === 'bundle'}
        onCommitSelected={handleCommitFromDiff}
        onDiscardSelected={handleDiscardFromDiff}
      />

      <FileContentModal
        open={fileModalOpen}
        onOpenChange={setFileModalOpen}
        files={fileContentEntries}
        title={fileContentTitle}
        onRestoreFile={fileContentCommitHash && file.type === 'bundle' ? handleRestoreFileFromCommit : undefined}
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
          onOpenChange={(open) => {
            if (!open) {
              setCommitDeployment(null)
              setPreSelectedFiles(undefined)
            }
          }}
          deployment={commitDeployment}
          onCommitted={handleCommitted}
          isBundle={file.type === 'bundle'}
          preSelectedFiles={preSelectedFiles}
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

      {applyFromDeployment && (
        <ApplyFromDialog
          open={!!applyFromDeployment}
          onOpenChange={(open) => !open && setApplyFromDeployment(null)}
          targetDeployment={applyFromDeployment}
          allDeployments={deployments}
          onApplied={handleApplied}
        />
      )}

      {partialDeployment && (
        <PartialDeployDialog
          open={!!partialDeployment}
          onOpenChange={(open) => {
            if (!open) {
              setPartialDeployment(null)
              setPartialCommitHash(undefined)
            }
          }}
          deployment={partialDeployment}
          bundleFiles={bundleEntries}
          onCreated={handlePartialCreated}
          initialCommitHash={partialCommitHash}
        />
      )}

      {/* Remove file confirmation dialog (unified) */}
      {removeFileEntry && removeFileDeployment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={closeRemoveDialog} />
          <div className="relative bg-card border border-border rounded-xl shadow-xl p-5 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-sm font-semibold">{t('removeFile')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('removeFileConfirm', { file: removeFileEntry })}
            </p>
            <div className="space-y-2">
              {/* Option 1: Delete from disk (this deployment only) */}
              <button
                onClick={confirmDeleteFromDisk}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors text-left"
              >
                <HardDrive className="w-4 h-4 shrink-0 text-warning" />
                <div>
                  <div className="font-medium">{t('removeFromDeploymentDelete')}</div>
                  <div className="text-muted-foreground mt-0.5">{t('removeFromDeploymentDeleteHint')}</div>
                </div>
              </button>
              {/* Option 2: Stop syncing (remove from bundle, keep on disk) */}
              <button
                onClick={() => confirmStopSyncing(false)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors text-left"
              >
                <GitBranch className="w-4 h-4 shrink-0 text-primary" />
                <div>
                  <div className="font-medium">{t('removeFromBundleOnly')}</div>
                  <div className="text-muted-foreground mt-0.5">{t('removeFromBundleOnlyHint')}</div>
                </div>
              </button>
              {/* Option 3: Stop syncing AND delete from disk */}
              <button
                onClick={() => confirmStopSyncing(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs border border-border rounded-lg hover:bg-destructive/10 hover:border-destructive/50 transition-colors text-left"
              >
                <HardDrive className="w-4 h-4 shrink-0 text-destructive" />
                <div>
                  <div className="font-medium text-destructive">{t('removeFromBundleAndDisk')}</div>
                  <div className="text-muted-foreground mt-0.5">{t('removeFromBundleAndDiskHint')}</div>
                </div>
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={closeRemoveDialog}
                className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
              >
                {tc('actions.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
