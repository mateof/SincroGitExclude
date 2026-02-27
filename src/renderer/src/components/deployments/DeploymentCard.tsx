import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useFileStore } from '@/stores/file-store'
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
  FileCode,
  Pencil,
  Check,
  X,
  FileX,
  Calendar,
  Clock,
  Tag,
  Plus,
  BookMarked,
  BookPlus,
  BookX,
  GitMerge,
  Undo2
} from 'lucide-react'

const TAG_COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'green', value: '#22c55e' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'purple', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
  { name: 'gray', value: '#6b7280' }
]

interface DeploymentCardProps {
  deployment: Deployment
  onViewHistory: (deployment: Deployment) => void
  onCommit: (deployment: Deployment) => void
  onViewDiff: (deployment: Deployment) => void
  onViewFile: (deployment: Deployment) => void
  onNewDeployment: (deploymentId: string) => void
  onApplyFrom: (deployment: Deployment) => void
}

export function DeploymentCard({
  deployment,
  onViewHistory,
  onCommit,
  onViewDiff,
  onViewFile,
  onNewDeployment,
  onApplyFrom
}: DeploymentCardProps) {
  const { t, i18n } = useTranslation('deployments')
  const { t: tc } = useTranslation('common')
  const { deactivateDeployment, reactivateDeployment, deleteDeployment, checkExclude, checkGitIgnore, checkChanges, updateDescription, setDeploymentTags } =
    useDeploymentStore()
  const { tags: allTags, createTag } = useFileStore()
  const { changedDeployments, deletedDeployments, clearChanged } = useWatcherStore()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [showTagEditor, setShowTagEditor] = useState(false)
  const [showTagCreate, setShowTagCreate] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[4].value)
  const tagEditorRef = useRef<HTMLDivElement>(null)

  const hasWatcherChanges = changedDeployments.has(deployment.id)
  const hasChanges = deployment.hasChanges || hasWatcherChanges
  const isDeleted = deletedDeployments.has(deployment.id)
  const fileMissing = deployment.fileExists === false || isDeleted

  const handleToggleExclude = async () => {
    if (deployment.isExcluded) {
      await window.api.invoke<IpcResult>('exclude:remove', deployment.id)
    } else {
      await window.api.invoke<IpcResult>('exclude:add', deployment.id)
    }
    await checkExclude(deployment.id)
  }

  const handleToggleGitIgnore = async () => {
    if (deployment.isInGitIgnore) {
      await window.api.invoke<IpcResult>('gitignore:remove', deployment.id)
    } else {
      await window.api.invoke<IpcResult>('gitignore:add', deployment.id)
    }
    await checkGitIgnore(deployment.id)
  }

  const handleDiscard = async () => {
    const result = await window.api.invoke<IpcResult>('commits:discard', deployment.id)
    if (result.success) {
      clearChanged(deployment.id)
      await checkChanges(deployment.id)
    }
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

  const startEditingDescription = () => {
    setDescriptionDraft(deployment.description ?? '')
    setEditingDescription(true)
  }

  const saveDescription = async () => {
    const trimmed = descriptionDraft.trim()
    await updateDescription(deployment.id, trimmed || null)
    setEditingDescription(false)
  }

  const cancelEditingDescription = () => {
    setEditingDescription(false)
  }

  const toggleTag = async (tagId: string) => {
    const currentIds = deployment.tags.map((t) => t.id)
    const newIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId]
    await setDeploymentTags(deployment.id, newIds)
  }

  const handleCreateTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed) return
    const tag = await createTag(trimmed, newTagColor)
    if (tag) {
      const currentIds = deployment.tags.map((t) => t.id)
      await setDeploymentTags(deployment.id, [...currentIds, tag.id])
      setNewTagName('')
      setNewTagColor(TAG_COLORS[4].value)
      setShowTagCreate(false)
    }
  }

  useEffect(() => {
    if (!showTagEditor) return
    const handleClick = (e: MouseEvent) => {
      if (tagEditorRef.current && !tagEditorRef.current.contains(e.target as Node)) {
        setShowTagEditor(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTagEditor])

  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        deployment.isActive
          ? fileMissing
            ? 'border-destructive/50 bg-card'
            : 'border-border bg-card'
          : 'border-border/50 bg-card/50 opacity-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div
              className="text-sm font-medium overflow-visible"
              data-tooltip={deployment.repoPath}
            >
              <span className="block truncate">
                {deployment.repoPath.split(/[/\\]/).slice(-2).join('/')}
              </span>
            </div>
            <div
              className="text-xs text-muted-foreground overflow-visible"
              data-tooltip={deployment.fullPath}
              data-tooltip-pos="bottom"
            >
              <span className="block truncate">
                {deployment.fileRelativePath}
              </span>
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

      {/* Tags */}
      {deployment.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {deployment.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: tag.color + '20', color: tag.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      <div className="mb-3">
        {editingDescription ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveDescription()
                if (e.key === 'Escape') cancelEditingDescription()
              }}
              placeholder={t('actions.descriptionPlaceholder')}
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-secondary border border-input rounded outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <button
              onClick={saveDescription}
              className="p-1 rounded hover:bg-success/10 text-success transition-colors"
              aria-label="Confirm"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={cancelEditingDescription}
              className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
              aria-label="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : deployment.description ? (
          <button
            onClick={startEditingDescription}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left w-full truncate"
          >
            {deployment.description}
          </button>
        ) : (
          <button
            onClick={startEditingDescription}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <Pencil className="w-3 h-3" />
            {t('actions.addDescription')}
          </button>
        )}
      </div>

      {/* Dates */}
      <div className="flex items-center gap-3 mb-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {t('actions.createdAt')} {new Date(deployment.createdAt).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
        {deployment.lastSyncedAt && (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {t('actions.lastModified')} {new Date(deployment.lastSyncedAt).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Indicators */}
      {deployment.isActive && (
        <div className="flex items-center gap-3 mb-3">
          {/* File missing */}
          {fileMissing && (
            <div className="flex items-center gap-1.5" data-tooltip={tc('status.fileMissingHint')}>
              <FileX className="w-3.5 h-3.5 text-destructive" />
              <span className="text-[10px] text-destructive">{tc('status.fileMissing')}</span>
            </div>
          )}

          {/* Exclude status */}
          <div className="flex items-center gap-1.5" data-tooltip={deployment.isExcluded ? tc('status.excludedHint') : tc('status.notExcludedHint')}>
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
            <div className="flex items-center gap-1.5" data-tooltip={tc('status.globallyExcludedHint')}>
              <ShieldEllipsis className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{tc('status.globallyExcluded')}</span>
            </div>
          )}

          {/* Gitignore status */}
          {deployment.isInGitIgnore && (
            <div className="flex items-center gap-1.5" data-tooltip={tc('status.inGitIgnoreHint')}>
              <BookMarked className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] text-blue-400">{tc('status.inGitIgnore')}</span>
            </div>
          )}

          {/* Changes indicator */}
          {hasChanges && (
            <div className="flex items-center gap-1.5" data-tooltip={tc('status.hasChangesHint')}>
              <CircleDot className="w-3.5 h-3.5 text-warning" />
              <span className="text-[10px] text-warning">{tc('status.hasChanges')}</span>
            </div>
          )}

          {!hasChanges && deployment.lastSyncedAt && (
            <div className="flex items-center gap-1.5" data-tooltip={tc('status.syncedHint')}>
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
              data-tooltip={deployment.isExcluded ? t('actions.removeExclude') : t('actions.addExclude')}
              aria-label={deployment.isExcluded ? t('actions.removeExclude') : t('actions.addExclude')}
            >
              {deployment.isExcluded ? (
                <ShieldX className="w-3.5 h-3.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Toggle gitignore */}
            <button
              onClick={handleToggleGitIgnore}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                deployment.isInGitIgnore
                  ? 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                  : 'hover:bg-blue-500/10 text-muted-foreground hover:text-blue-400'
              }`}
              data-tooltip={deployment.isInGitIgnore ? t('actions.removeGitIgnore') : t('actions.addGitIgnore')}
              aria-label={deployment.isInGitIgnore ? t('actions.removeGitIgnore') : t('actions.addGitIgnore')}
            >
              {deployment.isInGitIgnore ? (
                <BookX className="w-3.5 h-3.5" />
              ) : (
                <BookPlus className="w-3.5 h-3.5" />
              )}
            </button>

            {/* View file */}
            <button
              onClick={() => onViewFile(deployment)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              data-tooltip={t('actions.viewFile')}
            >
              <FileCode className="w-3.5 h-3.5" />
              {t('actions.viewFile')}
            </button>

            {/* View diff */}
            {hasChanges && (
              <button
                onClick={() => onViewDiff(deployment)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
                data-tooltip={t('actions.viewDiff')}
              >
                <Eye className="w-3.5 h-3.5" />
                {t('actions.viewDiff')}
              </button>
            )}

            {/* Commit */}
            {hasChanges && (
              <button
                onClick={() => onCommit(deployment)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors bg-primary/10 text-primary hover:bg-primary/20"
                data-tooltip={t('actions.commit')}
              >
                <GitCommitHorizontal className="w-3.5 h-3.5" />
                {t('actions.commit')}
              </button>
            )}

            {/* Discard changes */}
            {hasChanges && (
              <button
                onClick={handleDiscard}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                data-tooltip={t('actions.discardConfirm')}
                aria-label={t('actions.discardChanges')}
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t('actions.discardChanges')}
              </button>
            )}

            {/* Open folder */}
            <button
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              data-tooltip={t('actions.openFolder')}
              aria-label={t('actions.openFolder')}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>

            {/* History */}
            <button
              onClick={() => onViewHistory(deployment)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              data-tooltip={t('actions.history')}
            >
              <History className="w-3.5 h-3.5" />
              {t('actions.history')}
            </button>

            {/* Apply from another deployment */}
            {!hasChanges && (
              <button
                onClick={() => onApplyFrom(deployment)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                data-tooltip={t('actions.applyFrom')}
                aria-label={t('actions.applyFrom')}
              >
                <GitMerge className="w-3.5 h-3.5" />
              </button>
            )}

            {/* New deployment from this one */}
            <button
              onClick={() => onNewDeployment(deployment.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
              data-tooltip={t('actions.newDeployment')}
              aria-label={t('actions.newDeployment')}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>

            {/* Edit tags */}
            <div className="relative" ref={tagEditorRef}>
              <button
                onClick={() => { setShowTagEditor(!showTagEditor); setShowTagCreate(false) }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                  deployment.tags.length > 0
                    ? 'bg-primary/10 text-primary hover:bg-primary/20'
                    : 'hover:bg-secondary text-muted-foreground'
                }`}
                data-tooltip={t('tags.edit')}
                aria-label={t('tags.edit')}
              >
                <Tag className="w-3.5 h-3.5" />
              </button>
              {showTagEditor && (
                <div className="absolute left-0 bottom-full mb-1 z-20 w-52 bg-card border border-border rounded-lg shadow-xl p-2">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    {t('tags.edit')}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {allTags.map((tag) => {
                      const active = deployment.tags.some((dt) => dt.id === tag.id)
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all border"
                          style={{
                            backgroundColor: active ? tag.color + '25' : 'transparent',
                            borderColor: active ? tag.color : 'var(--color-border)',
                            color: active ? tag.color : 'var(--color-muted-foreground)'
                          }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </button>
                      )
                    })}
                    {!showTagCreate && (
                      <button
                        onClick={() => setShowTagCreate(true)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-muted-foreground border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        {t('tags.create')}
                      </button>
                    )}
                  </div>
                  {showTagCreate && (
                    <div className="mt-2 pt-2 border-t border-border space-y-1.5">
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleCreateTag() }
                          if (e.key === 'Escape') setShowTagCreate(false)
                        }}
                        placeholder={t('tags.namePlaceholder')}
                        autoFocus
                        className="w-full px-2 py-1 text-[10px] bg-background rounded border border-border focus:ring-1 focus:ring-primary outline-none"
                      />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground shrink-0">{t('tags.selectColor')}:</span>
                        <div className="flex gap-1">
                          {TAG_COLORS.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => setNewTagColor(c.value)}
                              className="w-4 h-4 rounded-full transition-transform"
                              style={{
                                backgroundColor: c.value,
                                outline: newTagColor === c.value ? '2px solid ' + c.value : 'none',
                                outlineOffset: '1px',
                                transform: newTagColor === c.value ? 'scale(1.15)' : 'scale(1)'
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setShowTagCreate(false)}
                          className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateTag}
                          disabled={!newTagName.trim()}
                          className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Deactivate */}
            <button
              onClick={handleDeactivate}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-auto"
              data-tooltip={t('actions.deactivate')}
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
              data-tooltip={t('actions.reactivate')}
            >
              <Power className="w-3.5 h-3.5" />
              {t('actions.reactivate')}
            </button>

            {/* Open folder */}
            <button
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              data-tooltip={t('actions.openFolder')}
              aria-label={t('actions.openFolder')}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>

            {/* History (even when inactive) */}
            <button
              onClick={() => onViewHistory(deployment)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-secondary transition-colors text-muted-foreground"
              data-tooltip={t('actions.history')}
            >
              <History className="w-3.5 h-3.5" />
            </button>

            {/* Edit tags (inactive) */}
            <div className="relative" ref={tagEditorRef}>
              <button
                onClick={() => { setShowTagEditor(!showTagEditor); setShowTagCreate(false) }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                  deployment.tags.length > 0
                    ? 'bg-primary/10 text-primary hover:bg-primary/20'
                    : 'hover:bg-secondary text-muted-foreground'
                }`}
                data-tooltip={t('tags.edit')}
                aria-label={t('tags.edit')}
              >
                <Tag className="w-3.5 h-3.5" />
              </button>
              {showTagEditor && (
                <div className="absolute left-0 bottom-full mb-1 z-20 w-52 bg-card border border-border rounded-lg shadow-xl p-2">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    {t('tags.edit')}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {allTags.map((tag) => {
                      const active = deployment.tags.some((dt) => dt.id === tag.id)
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all border"
                          style={{
                            backgroundColor: active ? tag.color + '25' : 'transparent',
                            borderColor: active ? tag.color : 'var(--color-border)',
                            color: active ? tag.color : 'var(--color-muted-foreground)'
                          }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </button>
                      )
                    })}
                    {!showTagCreate && (
                      <button
                        onClick={() => setShowTagCreate(true)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-muted-foreground border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        {t('tags.create')}
                      </button>
                    )}
                  </div>
                  {showTagCreate && (
                    <div className="mt-2 pt-2 border-t border-border space-y-1.5">
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleCreateTag() }
                          if (e.key === 'Escape') setShowTagCreate(false)
                        }}
                        placeholder={t('tags.namePlaceholder')}
                        autoFocus
                        className="w-full px-2 py-1 text-[10px] bg-background rounded border border-border focus:ring-1 focus:ring-primary outline-none"
                      />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground shrink-0">{t('tags.selectColor')}:</span>
                        <div className="flex gap-1">
                          {TAG_COLORS.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => setNewTagColor(c.value)}
                              className="w-4 h-4 rounded-full transition-transform"
                              style={{
                                backgroundColor: c.value,
                                outline: newTagColor === c.value ? '2px solid ' + c.value : 'none',
                                outlineOffset: '1px',
                                transform: newTagColor === c.value ? 'scale(1.15)' : 'scale(1)'
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setShowTagCreate(false)}
                          className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateTag}
                          disabled={!newTagName.trim()}
                          className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Delete */}
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ml-auto hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              data-tooltip={tc('actions.delete')}
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
