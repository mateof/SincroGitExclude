import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useUIStore } from '@/stores/ui-store'
import type { IpcResult } from '@/types'
import { TagSelector } from './TagSelector'
import { X, Search, FolderGit2, CheckCircle2, Download } from 'lucide-react'

interface SelectFileResult {
  type: 'file'
  fileName: string
  filePath: string
  repoPath: string | null
  fileRelativePath: string | null
}

interface SelectBundleResult {
  type: 'bundle'
  folderName: string
  filePaths: string[]
  basePath: string
  relativePaths: string[]
  repoPath: string | null
  baseRelativePath: string | null
}

type SelectItemsResult = SelectFileResult | SelectBundleResult

interface FileCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FileCreateDialog({ open, onOpenChange }: FileCreateDialogProps) {
  const { t } = useTranslation('files')
  const { t: tc } = useTranslation('common')
  const { createFile, createBundle } = useFileStore()
  const { createDeployment } = useDeploymentStore()
  const { selectFile } = useUIStore()
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Selection result
  const [selection, setSelection] = useState<SelectItemsResult | null>(null)

  if (!open) return null

  const reset = () => {
    setName('')
    setAlias('')
    setSelectedTagIds([])
    setSelection(null)
  }

  const generateSlug = (text: string): string => {
    return text
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
  }

  const applySelection = (data: SelectItemsResult) => {
    setSelection(data)
    if (data.type === 'file') {
      if (!name) setName(data.fileName)
      if (!alias) setAlias(generateSlug(data.fileName) || data.fileName)
    } else {
      if (!name) setName(data.folderName)
      if (!alias) setAlias(generateSlug(data.folderName) || data.folderName)
    }
  }

  const handleSelect = async () => {
    const result = await window.api.invoke<IpcResult<SelectItemsResult>>(
      'dialog:select-items'
    )
    if (!result || !result.success || !result.data) return
    applySelection(result.data)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const filePath = window.api.getPathForFile(files[i])
      if (filePath) paths.push(filePath)
    }
    if (paths.length === 0) return

    const result = await window.api.invoke<IpcResult<SelectItemsResult>>(
      'dialog:resolve-items',
      paths
    )
    if (!result || !result.success || !result.data) return
    applySelection(result.data)
  }

  const isBundle = selection?.type === 'bundle'
  const detectedRepo = selection?.repoPath
  const detectedRelPath = isBundle
    ? (selection as SelectBundleResult).baseRelativePath
    : (selection as SelectFileResult | null)?.fileRelativePath

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !alias.trim()) return

    setLoading(true)

    const tagIds = selectedTagIds.length > 0 ? selectedTagIds : undefined

    if (selection?.type === 'bundle') {
      const bundle = selection as SelectBundleResult
      const file = await createBundle(
        name.trim(),
        alias.trim(),
        bundle.filePaths,
        bundle.basePath,
        tagIds
      )

      if (file) {
        if (bundle.repoPath && bundle.baseRelativePath) {
          const autoExclude = localStorage.getItem('autoExclude') !== 'false'
          await createDeployment(
            file.id,
            bundle.repoPath,
            bundle.baseRelativePath,
            undefined,
            undefined,
            autoExclude
          )
        }
        selectFile(file.id)
        reset()
        onOpenChange(false)
      }
    } else {
      const file = await createFile(name.trim(), alias.trim(), tagIds)

      if (file && selection?.type === 'file') {
        const single = selection as SelectFileResult
        if (single.repoPath && single.fileRelativePath) {
          const autoExclude = localStorage.getItem('autoExclude') !== 'false'
          await createDeployment(
            file.id,
            single.repoPath,
            single.fileRelativePath,
            undefined,
            undefined,
            autoExclude
          )
        }
        selectFile(file.id)
        reset()
        onOpenChange(false)
      } else if (file) {
        selectFile(file.id)
        reset()
        onOpenChange(false)
      }
    }

    setLoading(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging false when leaving the modal itself, not children
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { clientX, clientY } = e
    if (
      clientX <= rect.left ||
      clientX >= rect.right ||
      clientY <= rect.top ||
      clientY >= rect.bottom
    ) {
      setDragging(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div
        className={`relative bg-card border-2 rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border'
        }`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('createTitle')}</h2>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selection zone: click or drag & drop */}
        <div className="mb-5">
          <button
            type="button"
            onClick={handleSelect}
            className={`w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-lg transition-colors group ${
              dragging
                ? 'border-primary bg-primary/10 scale-[1.01]'
                : selection
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5'
            }`}
          >
            <Search className={`w-5 h-5 transition-colors ${dragging ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
            <div className="text-left">
              <div className={`text-sm font-medium transition-colors ${dragging ? 'text-primary' : 'group-hover:text-primary'}`}>
                {t('selectFileOrFolder', { defaultValue: 'Select or drop file / folder' })}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t('selectFileOrFolderHint', {
                  defaultValue: 'Click to browse or drag and drop files / folders here'
                })}
              </div>
            </div>
          </button>

          {/* Selection info */}
          {selection && (
            <div className="mt-2 p-3 bg-secondary/50 rounded-lg space-y-2">
              {selection.type === 'file' ? (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium">{tc('labels.path', { defaultValue: 'Path' })}:</span>
                    <span className="truncate" title={selection.filePath}>{selection.filePath}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium">
                      {t('bundleFiles')} ({selection.filePaths.length}):
                    </span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {selection.relativePaths.map((rp, i) => (
                      <div
                        key={i}
                        className="text-[10px] text-muted-foreground pl-2 font-mono truncate"
                        title={selection.filePaths[i]}
                      >
                        {rp}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Git repo info */}
              {selection.repoPath ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <FolderGit2 className="w-3.5 h-3.5 text-success shrink-0" />
                  <span className="text-success">{t('detectedRepo')}:</span>
                  <span className="text-muted-foreground truncate" title={selection.repoPath}>
                    {selection.repoPath.split(/[/\\]/).slice(-2).join('/')}
                  </span>
                </div>
              ) : (
                <div className="text-xs text-warning">{t('noRepoDetected')}</div>
              )}

              {detectedRelPath && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium">{t('relativePath')}:</span>
                  <code className="text-[10px] bg-background px-1.5 py-0.5 rounded">{detectedRelPath}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drag overlay */}
        {dragging && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card/90 rounded-xl pointer-events-none">
            <Download className="w-10 h-10 text-primary animate-bounce" />
            <span className="mt-2 text-sm font-medium text-primary">
              {t('selectFileOrFolder', { defaultValue: 'Select or drop file / folder' })}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('fields.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isBundle ? 'config-files' : 'database.env'}
              autoFocus
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('fields.alias')}
            </label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={isBundle ? 'config' : 'db-env'}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>

          <TagSelector selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />

          {/* Summary */}
          {detectedRepo && detectedRelPath && (
            <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-primary">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('willCreateDeployment')}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { reset(); onOpenChange(false) }}
              className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
            >
              {tc('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !alias.trim() || loading}
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
