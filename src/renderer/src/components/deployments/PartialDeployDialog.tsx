import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useUIStore } from '@/stores/ui-store'
import { TagSelector } from '../files/TagSelector'
import type { Deployment, CommitInfo, IpcResult } from '@/types'
import {
  X,
  FolderOpen,
  FolderGit2,
  AlertCircle,
  CheckSquare,
  Square,
  CheckCircle2,
  File,
  FolderArchive,
  GitCommitHorizontal,
  Loader2
} from 'lucide-react'

interface ResolveResult {
  fullPath: string
  isDirectory: boolean
  repoPath: string | null
  relativePath: string | null
}

interface PartialDeployDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deployment: Deployment
  bundleFiles: string[]
  onCreated: (fileId: string) => void
  initialCommitHash?: string
}

export function PartialDeployDialog({
  open,
  onOpenChange,
  deployment,
  bundleFiles,
  onCreated,
  initialCommitHash
}: PartialDeployDialogProps) {
  const { t } = useTranslation('deployments')
  const { t: tc } = useTranslation('common')
  const { t: tf } = useTranslation('files')
  const { createFile, createBundle, createFromCommit } = useFileStore()
  const { createDeployment } = useDeploymentStore()
  const { selectFile } = useUIStore()

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedFolder, setSelectedFolder] = useState('')
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [folderRelativePath, setFolderRelativePath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Commit selector state
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>('current')
  const [commitFiles, setCommitFiles] = useState<string[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedFiles(new Set())
      setName('')
      setAlias('')
      setSelectedTagIds([])
      setSelectedFolder('')
      setRepoPath(null)
      setFolderRelativePath(null)
      setError('')
      setCommits([])
      setSelectedCommitHash(initialCommitHash || 'current')
      setCommitFiles([])

      // Load commits for the deployment
      window.api
        .invoke<IpcResult<CommitInfo[]>>('commits:list', deployment.id)
        .then((result) => {
          if (result.success && result.data) {
            setCommits(result.data)
          }
        })

      // If initial commit hash, load files for it
      if (initialCommitHash) {
        loadFilesForCommit(initialCommitHash)
      }
    }
  }, [open])

  const loadFilesForCommit = async (hash: string) => {
    setLoadingFiles(true)
    setSelectedFiles(new Set())
    const result = await window.api.invoke<
      IpcResult<Array<{ path: string; content: string }>>
    >('commits:files-at', deployment.id, hash)
    if (result.success && result.data) {
      setCommitFiles(result.data.map((f) => f.path))
    }
    setLoadingFiles(false)
  }

  const handleCommitChange = (hash: string) => {
    setSelectedCommitHash(hash)
    setSelectedFiles(new Set())
    setName('')
    setAlias('')
    if (hash === 'current') {
      setCommitFiles([])
    } else {
      loadFilesForCommit(hash)
    }
  }

  if (!open) return null

  // Use commit files if a commit is selected, otherwise use bundleFiles (current deployed)
  const availableFiles = selectedCommitHash === 'current' ? bundleFiles : commitFiles
  const isFromCommit = selectedCommitHash !== 'current'

  const generateSlug = (text: string): string => {
    return text
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
  }

  const toggleFile = (file: string) => {
    const next = new Set(selectedFiles)
    if (next.has(file)) {
      next.delete(file)
    } else {
      next.add(file)
    }
    setSelectedFiles(next)

    // Auto-fill name/alias based on selection
    if (next.size === 1) {
      const single = Array.from(next)[0]
      const fileName = single.split('/').pop() || single
      if (!name) setName(fileName)
      if (!alias) setAlias(generateSlug(fileName) || fileName)
    } else if (next.size > 1 && selectedFiles.size <= 1) {
      // Switching from 0-1 to multiple: suggest a name based on common path
      const parts = Array.from(next).map((f) => f.split('/'))
      let common = ''
      if (parts.length > 0 && parts[0].length > 1) {
        common = parts[0][0]
        for (let i = 1; i < parts.length; i++) {
          if (parts[i][0] !== common) {
            common = ''
            break
          }
        }
      }
      if (common && !name) {
        setName(common)
        setAlias(generateSlug(common) || common)
      }
    }
  }

  const toggleAll = () => {
    if (selectedFiles.size === availableFiles.length) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(availableFiles))
    }
  }

  const isSingleFile = selectedFiles.size === 1

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

  // Compute the deploy relative path
  const deployRelativePath =
    folderRelativePath !== null
      ? isSingleFile
        ? folderRelativePath === '.'
          ? name.trim()
          : `${folderRelativePath}/${name.trim()}`
        : folderRelativePath
      : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedFiles.size === 0 || !name.trim() || !alias.trim()) return

    setLoading(true)
    setError('')

    const tagIds = selectedTagIds.length > 0 ? selectedTagIds : undefined
    const autoExclude = localStorage.getItem('autoExclude') !== 'false'

    try {
      let file

      if (isFromCommit) {
        // Create from commit using createFromCommit
        file = await createFromCommit(
          name.trim(),
          alias.trim(),
          deployment.id,
          selectedCommitHash,
          Array.from(selectedFiles),
          tagIds
        )
      } else {
        // Create from current deployed files
        const deployBasePath =
          `${deployment.repoPath}/${deployment.fileRelativePath}`.replace(/\\/g, '/')
        const absolutePaths = Array.from(selectedFiles).map((f) => `${deployBasePath}/${f}`)

        if (isSingleFile) {
          file = await createFile(name.trim(), alias.trim(), tagIds, absolutePaths[0])
        } else {
          file = await createBundle(
            name.trim(),
            alias.trim(),
            absolutePaths,
            deployBasePath,
            tagIds
          )
        }
      }

      if (file) {
        if (repoPath && deployRelativePath) {
          await createDeployment(
            file.id,
            repoPath,
            deployRelativePath,
            undefined,
            undefined,
            autoExclude
          )
        }
        selectFile(file.id)
        onCreated(file.id)
        onOpenChange(false)
      } else {
        setError(tc('messages.error', { defaultValue: 'An error occurred' }))
      }
    } catch {
      setError(tc('messages.error', { defaultValue: 'An error occurred' }))
    }

    setLoading(false)
  }

  const canSubmit = selectedFiles.size > 0 && name.trim() && alias.trim() && !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {t('partialDeploy.title', { defaultValue: 'Extract files' })}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {t('partialDeploy.description', {
            defaultValue:
              'Create a new managed file from selected files of this bundle'
          })}
        </p>

        {/* Commit selector */}
        {commits.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              <GitCommitHorizontal className="w-3 h-3 inline mr-1" />
              {t('partialDeploy.sourceCommit', { defaultValue: 'Source commit' })}
            </label>
            <select
              value={selectedCommitHash}
              onChange={(e) => handleCommitChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            >
              <option value="current">
                {t('partialDeploy.currentFiles', { defaultValue: 'Current (deployed files)' })}
              </option>
              {commits.map((c) => (
                <option key={c.hash} value={c.hash}>
                  {c.hash.substring(0, 7)} - {c.message}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* File selection */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('partialDeploy.selectFiles', {
                defaultValue: 'Select files to extract'
              })}
            </label>
            {availableFiles.length > 0 && !loadingFiles && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[10px] text-primary hover:underline"
              >
                {selectedFiles.size === availableFiles.length
                  ? t('partialDeploy.deselectAll', { defaultValue: 'Deselect all' })
                  : t('partialDeploy.selectAll', { defaultValue: 'Select all' })}
              </button>
            )}
          </div>

          <div className="border border-border rounded-lg max-h-48 overflow-y-auto">
            {loadingFiles ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {tc('labels.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : availableFiles.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t('partialDeploy.noFilesAvailable', {
                  defaultValue: 'No files available'
                })}
              </div>
            ) : (
              availableFiles.map((file) => {
                const selected = selectedFiles.has(file)
                return (
                  <button
                    key={file}
                    type="button"
                    onClick={() => toggleFile(file)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      selected
                        ? 'bg-primary/5 text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    {selected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                    ) : (
                      <Square className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="text-[11px] font-mono truncate" title={file}>
                      {file}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {selectedFiles.size > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {isSingleFile ? (
                <>
                  <File className="w-3 h-3" />
                  {t('partialDeploy.willCreateFile', {
                    defaultValue: 'Will create a single file'
                  })}
                </>
              ) : (
                <>
                  <FolderArchive className="w-3 h-3" />
                  {t('partialDeploy.willCreateBundle', {
                    defaultValue: 'Will create a bundle with {{count}} files',
                    count: selectedFiles.size
                  })}
                </>
              )}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {tf('fields.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isSingleFile ? 'config.env' : 'config-files'}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>

          {/* Alias */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {tf('fields.alias')}
            </label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={isSingleFile ? 'config' : 'config-files'}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>

          {/* Tags */}
          <TagSelector selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />

          {/* Destination folder */}
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

          {/* Summary */}
          {repoPath && deployRelativePath && selectedFiles.size > 0 && (
            <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-primary">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {tf('willCreateDeployment', {
                  defaultValue: 'A deployment will be created automatically'
                })}
              </span>
            </div>
          )}

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
