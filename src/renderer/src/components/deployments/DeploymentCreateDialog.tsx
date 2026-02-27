import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useFileStore } from '@/stores/file-store'
import type { CommitInfo, Deployment, IpcResult } from '@/types'
import { X, FolderOpen, FolderGit2, AlertCircle, FileSearch } from 'lucide-react'

interface ResolveResult {
  fullPath: string
  isDirectory: boolean
  repoPath: string | null
  relativePath: string | null
}

interface DeploymentCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileId: string
  sourceDeploymentId?: string
  sourceCommitHash?: string
}

export function DeploymentCreateDialog({
  open,
  onOpenChange,
  fileId,
  sourceDeploymentId,
  sourceCommitHash
}: DeploymentCreateDialogProps) {
  const { t } = useTranslation('deployments')
  const { t: tc } = useTranslation('common')
  const { deployments, createDeployment } = useDeploymentStore()
  const { files } = useFileStore()
  const file = files.find((f) => f.id === fileId)
  const isBundle = file?.type === 'bundle'

  const [selectedFolder, setSelectedFolder] = useState('')
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [folderRelativePath, setFolderRelativePath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Source selectors
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('')
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [selectedCommitHash, setSelectedCommitHash] = useState('')
  const [loadingCommits, setLoadingCommits] = useState(false)

  // Filter deployments for the same file
  const fileDeployments = deployments.filter((d) => d.fileId === fileId)

  useEffect(() => {
    if (open) {
      setSelectedFolder('')
      setRepoPath(null)
      setFolderRelativePath(null)
      setError('')
      setSelectedDeploymentId(sourceDeploymentId || '')
      setSelectedCommitHash(sourceCommitHash || '')
      setCommits([])

      if (sourceDeploymentId) {
        loadCommitsForDeployment(sourceDeploymentId, sourceCommitHash)
      }
    }
  }, [open, fileId, sourceDeploymentId, sourceCommitHash])

  const loadCommitsForDeployment = async (deploymentId: string, preselectedHash?: string) => {
    if (!deploymentId) {
      setCommits([])
      setSelectedCommitHash('')
      return
    }

    setLoadingCommits(true)
    const result = await window.api.invoke<IpcResult<CommitInfo[]>>(
      'commits:list',
      deploymentId
    )
    if (result.success && result.data) {
      setCommits(result.data)
      // Pre-select the specified commit, or the latest one
      if (preselectedHash && result.data.some((c) => c.hash === preselectedHash)) {
        setSelectedCommitHash(preselectedHash)
      } else if (result.data.length > 0) {
        setSelectedCommitHash(result.data[0].hash)
      }
    }
    setLoadingCommits(false)
  }

  const handleDeploymentChange = (deploymentId: string) => {
    setSelectedDeploymentId(deploymentId)
    setSelectedCommitHash('')
    setCommits([])
    if (deploymentId) {
      loadCommitsForDeployment(deploymentId)
    }
  }

  if (!open) return null

  // For single files, the final relative path includes the file name
  const deployRelativePath = folderRelativePath !== null
    ? isBundle
      ? folderRelativePath
      : folderRelativePath === '.'
        ? file?.name ?? ''
        : `${folderRelativePath}/${file?.name ?? ''}`
    : null

  // Resolve source branch from selected deployment
  const sourceDeployment = fileDeployments.find((d) => d.id === selectedDeploymentId)
  const sourceBranch = sourceDeployment?.branchName || undefined
  const sourceCommit = selectedCommitHash || undefined

  const handleSelectFolder = async () => {
    const path = await window.api.selectDirectory()
    if (!path) return

    setSelectedFolder(path)
    setError('')

    const result = await window.api.invoke<IpcResult<ResolveResult>>(
      'dialog:resolve-deploy-target',
      path
    )

    if (result.success && result.data) {
      setRepoPath(result.data.repoPath)
      setFolderRelativePath(result.data.relativePath)
    }
  }

  const handleSelectFile = async () => {
    const path = await window.api.selectFile()
    if (!path) return

    setError('')

    // Validate filename matches
    const fileName = path.split(/[/\\]/).pop() || ''
    if (fileName !== file?.name) {
      setError(t('fileNameMismatch', { name: file?.name }))
      return
    }

    const result = await window.api.invoke<IpcResult<ResolveResult>>(
      'dialog:resolve-deploy-target',
      path
    )

    if (!result.success || !result.data?.repoPath || !result.data?.relativePath) {
      setError(t('noRepoDetected'))
      return
    }

    // Compute folder relative path (strip filename from relativePath)
    const parts = result.data.relativePath.split('/')
    parts.pop()
    const folder = parts.join('/') || '.'

    // Check not already deployed
    const fullRelPath = folder === '.' ? file!.name : `${folder}/${file!.name}`
    const alreadyDeployed = fileDeployments.some(
      (d) => d.repoPath === result.data!.repoPath && d.fileRelativePath === fullRelPath
    )
    if (alreadyDeployed) {
      setError(t('alreadyDeployed'))
      return
    }

    setSelectedFolder(path)
    setRepoPath(result.data.repoPath)
    setFolderRelativePath(folder)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repoPath || !deployRelativePath) return

    setLoading(true)
    setError('')

    const autoExclude = localStorage.getItem('autoExclude') !== 'false'
    const result = await createDeployment(
      fileId,
      repoPath,
      deployRelativePath,
      sourceBranch,
      sourceCommit,
      autoExclude
    )

    setLoading(false)

    if (result) {
      onOpenChange(false)
    } else {
      setError(
        t('messages.createError', {
          defaultValue:
            'Failed to create deployment. Make sure the path is inside a valid git repository.'
        })
      )
    }
  }

  const canSubmit = repoPath && deployRelativePath && !loading

  const formatDeploymentLabel = (d: Deployment) => {
    const repoShort = d.repoPath.split(/[/\\]/).slice(-2).join('/')
    return `${repoShort} / ${d.fileRelativePath}`
  }

  const formatCommitLabel = (c: CommitInfo) => {
    const shortHash = c.hash.substring(0, 7)
    const msgShort = c.message.length > 40 ? c.message.substring(0, 40) + '...' : c.message
    return `${shortHash} - ${msgShort}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('createTitle')}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Source deployment selector */}
          {fileDeployments.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {t('fields.sourceDeployment')}{' '}
                <span className="text-muted-foreground/50">
                  ({tc('labels.optional', { defaultValue: 'optional' })})
                </span>
              </label>
              <select
                value={selectedDeploymentId}
                onChange={(e) => handleDeploymentChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              >
                <option value="">{t('fields.noSource')}</option>
                {fileDeployments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {formatDeploymentLabel(d)}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('fields.sourceDeploymentHint')}
              </p>
            </div>
          )}

          {/* Source commit selector */}
          {selectedDeploymentId && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {t('fields.sourceCommit')}{' '}
                <span className="text-muted-foreground/50">
                  ({tc('labels.optional', { defaultValue: 'optional' })})
                </span>
              </label>
              {loadingCommits ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
              ) : commits.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground bg-secondary rounded-lg border border-border">
                  {tc('messages.noData', { defaultValue: 'No commits available' })}
                </div>
              ) : (
                <select
                  value={selectedCommitHash}
                  onChange={(e) => setSelectedCommitHash(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none font-mono"
                >
                  {commits.map((c) => (
                    <option key={c.hash} value={c.hash}>
                      {formatCommitLabel(c)}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('fields.sourceCommitHint')}
              </p>
            </div>
          )}

          {/* Select destination folder */}
          <div>
            <button
              type="button"
              onClick={handleSelectFolder}
              className={`w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-lg transition-colors group ${
                selectedFolder
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5'
              }`}
            >
              <FolderOpen className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <div className="text-left">
                <div className="text-sm font-medium group-hover:text-primary transition-colors">
                  {t('selectDestinationFolder', {
                    defaultValue: 'Select destination folder'
                  })}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {t('selectDestinationFolderHint', {
                    defaultValue:
                      'Select the folder inside a git repo where the files will be deployed'
                  })}
                </div>
              </div>
            </button>

            {/* Select existing file (only for single files, not bundles) */}
            {!isBundle && (
              <>
                <div className="flex items-center gap-2 my-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground uppercase">{t('or')}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <button
                  type="button"
                  onClick={handleSelectFile}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-lg transition-colors group ${
                    selectedFolder && !selectedFolder.endsWith('/')
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-primary/5'
                  }`}
                >
                  <FileSearch className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  <div className="text-left">
                    <div className="text-sm font-medium group-hover:text-primary transition-colors">
                      {t('selectExistingFile')}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('selectExistingFileHint')}
                    </div>
                  </div>
                </button>
              </>
            )}

            {/* Detected info */}
            {selectedFolder && (
              <div className="mt-2 p-3 bg-secondary/50 rounded-lg space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium">
                    {tc('labels.folder', { defaultValue: 'Folder' })}:
                  </span>
                  <span className="truncate" title={selectedFolder}>
                    {selectedFolder}
                  </span>
                </div>

                {repoPath ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs">
                      <FolderGit2 className="w-3.5 h-3.5 text-success shrink-0" />
                      <span className="text-success">
                        {t('repoDetected', { defaultValue: 'Git repo detected' })}:
                      </span>
                      <span className="text-muted-foreground truncate" title={repoPath}>
                        {repoPath.split(/[/\\]/).slice(-2).join('/')}
                      </span>
                    </div>
                    {deployRelativePath && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">
                          {t('deployTarget', { defaultValue: 'Deploy target' })}:
                        </span>
                        <code className="text-[10px] bg-background px-1.5 py-0.5 rounded">
                          {deployRelativePath}
                        </code>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {t('noRepoDetected', {
                      defaultValue:
                        'No git repo detected. The destination must be inside a git repository.'
                    })}
                  </div>
                )}
              </div>
            )}
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
              disabled={!canSubmit}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : tc('actions.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
