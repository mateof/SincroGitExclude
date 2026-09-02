import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRepoStore } from '@/stores/repo-store'
import { useUIStore } from '@/stores/ui-store'
import type { Repo, ExcludeEntry, RepoDeploymentRow } from '@/types'
import { RepoEditDialog } from '@/components/repos/RepoEditDialog'
import { RepoDeploymentGroup } from '@/components/repos/RepoDeploymentGroup'
import { ExcludeEntryList } from '@/components/repos/ExcludeEntryList'
import { AddExcludeDialog } from '@/components/repos/AddExcludeDialog'
import { RemoveExcludeConfirmDialog } from '@/components/repos/RemoveExcludeConfirmDialog'
import {
  FolderGit2,
  FolderOpen,
  Pencil,
  Trash2,
  Copy,
  AlertCircle,
  ShieldOff,
  GitBranch,
  Globe,
  Plus,
  ArrowLeft
} from 'lucide-react'

interface RepoDetailPageProps {
  repoId: string
}

type Tab = 'managed' | 'exclude'

export function RepoDetailPage({ repoId }: RepoDetailPageProps) {
  const { isWebMode } = useUIStore()
  const { t } = useTranslation('repos')
  const { t: tc } = useTranslation('common')
  const {
    repos,
    getRepoDetail,
    listExcludes,
    addExclude,
    removeExclude,
    listRepoDeployments,
    removeRepo
  } = useRepoStore()

  const repoFromList = useMemo(() => repos.find((r) => r.id === repoId), [repos, repoId])
  const [repo, setRepo] = useState<Repo | null>(repoFromList ?? null)
  const [tab, setTab] = useState<Tab>('managed')
  const [deployments, setDeployments] = useState<RepoDeploymentRow[]>([])
  const [excludes, setExcludes] = useState<ExcludeEntry[]>([])
  const [excludeError, setExcludeError] = useState<string | null>(null)

  const [showEdit, setShowEdit] = useState(false)
  const [showAddExclude, setShowAddExclude] = useState(false)
  const [removeEntry, setRemoveEntry] = useState<ExcludeEntry | null>(null)
  const [showRemoveRepo, setShowRemoveRepo] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)

  useEffect(() => {
    setExcludeError(null)
    getRepoDetail(repoId).then((r) => setRepo(r))
    listRepoDeployments(repoId).then(setDeployments)
    listExcludes(repoId).then(setExcludes)
  }, [repoId, getRepoDetail, listRepoDeployments, listExcludes])

  if (!repo) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground">{tc('loading', { defaultValue: 'Loading...' })}</p>
      </div>
    )
  }

  const reloadExcludes = async () => {
    const fresh = await listExcludes(repoId)
    setExcludes(fresh)
  }

  const reloadAll = async () => {
    const fresh = await getRepoDetail(repoId)
    if (fresh) setRepo(fresh)
    setDeployments(await listRepoDeployments(repoId))
    setExcludes(await listExcludes(repoId))
  }

  const handleAddExclude = async (patterns: string[]) => {
    for (const pattern of patterns) {
      await addExclude(repoId, pattern)
    }
    await reloadAll()
  }

  const handleRemoveExcludeConfirm = async () => {
    if (!removeEntry) return
    const result = await removeExclude(repoId, removeEntry.lineNumber, removeEntry.pattern)
    if (!result.success) {
      setExcludeError(result.error || t('exclude.externalEditWarning'))
      await reloadExcludes()
    } else {
      setExcludeError(null)
      await reloadAll()
    }
    setRemoveEntry(null)
  }

  const handleCopyPath = async () => {
    await navigator.clipboard.writeText(repo.path)
    setPathCopied(true)
    setTimeout(() => setPathCopied(false), 1500)
  }

  const handleOpenFolder = () => {
    window.api.invoke('shell:show-in-folder', repo.path)
  }

  const handleRemoveRepo = async () => {
    try {
      await removeRepo(repoId)
      setShowRemoveRepo(false)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const startEditDescription = async () => {
    setShowEdit(true)
  }

  const removeBlocked = repo.deploymentCount > 0

  // Group deployments by file for the managed tab
  const groupedDeployments = useMemo(() => {
    const map = new Map<string, RepoDeploymentRow[]>()
    for (const d of deployments) {
      if (!map.has(d.fileId)) map.set(d.fileId, [])
      map.get(d.fileId)!.push(d)
    }
    return Array.from(map.entries()).map(([fileId, items]) => ({
      fileId,
      fileName: items[0].fileName,
      fileAlias: items[0].fileAlias,
      fileType: items[0].fileType,
      deployments: items
    }))
  }, [deployments])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-2">
            <FolderGit2 className="w-6 h-6 text-primary shrink-0" />
            <h1 className="text-xl font-bold truncate">{repo.displayName}</h1>
            {repo.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {repo.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: tag.color + '20', color: tag.color }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleCopyPath}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono truncate max-w-full"
            title={t('detail.copyPath')}
          >
            <Copy className="w-3 h-3 shrink-0" />
            <span className="truncate">{repo.path}</span>
            {pathCopied && (
              <span className="text-success text-[10px] ml-1">{t('detail.pathCopied')}</span>
            )}
          </button>

          <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted-foreground">
            {repo.currentBranch && (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                {t('detail.branch')}: <span className="text-foreground">{repo.currentBranch}</span>
              </span>
            )}
            {repo.remoteUrl && (
              <span
                className="inline-flex items-center gap-1 truncate max-w-[300px]"
                title={repo.remoteUrl}
              >
                <Globe className="w-3 h-3 shrink-0" />
                <span className="truncate">{repo.remoteUrl}</span>
              </span>
            )}
            <span>
              {repo.deploymentCount} {t('detail.deploymentsCount')}
            </span>
            {repo.filesCount > 0 && (
              <span>
                · {repo.filesCount} {t('detail.filesCount')}
              </span>
            )}
          </div>

          {/* Description */}
          {repo.description && (
            <p className="mt-3 text-xs text-muted-foreground">{repo.description}</p>
          )}

          {/* Warnings */}
          {!repo.pathExists && (
            <div className="mt-3 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {t('status.pathMissing')}
            </div>
          )}
          {repo.pathExists && !repo.isValidGit && (
            <div className="mt-3 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-xs text-destructive">
              <ShieldOff className="w-4 h-4 shrink-0" />
              {t('status.notGitRepo')}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Desktop only: the explorer would open on the server's machine */}
          {!isWebMode && (
            <button
              onClick={handleOpenFolder}
              disabled={!repo.pathExists}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t('detail.openInExplorer')}
            </button>
          )}
          <button
            onClick={startEditDescription}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            {tc('actions.edit')}
          </button>
          <button
            onClick={() => !removeBlocked && setShowRemoveRepo(true)}
            disabled={removeBlocked}
            data-tooltip={
              removeBlocked
                ? t('detail.removeBlocked', { count: repo.deploymentCount })
                : t('detail.remove')
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('detail.remove')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setTab('managed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'managed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('detail.tabManaged')} ({deployments.length})
        </button>
        <button
          onClick={() => setTab('exclude')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'exclude'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('detail.tabExclude')} ({excludes.length})
        </button>
      </div>

      {/* Tab content */}
      {tab === 'managed' && (
        <div className="space-y-3">
          {groupedDeployments.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
              <p>{t('detail.noDeployments')}</p>
              <p className="mt-2 text-xs">{t('detail.addStandaloneHint')}</p>
            </div>
          ) : (
            groupedDeployments.map((g) => (
              <RepoDeploymentGroup
                key={g.fileId}
                fileId={g.fileId}
                fileName={g.fileName}
                fileAlias={g.fileAlias}
                fileType={g.fileType}
                deployments={g.deployments}
              />
            ))
          )}
        </div>
      )}

      {tab === 'exclude' && (
        <div className="space-y-3">
          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowAddExclude(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('exclude.addEntry')}
            </button>
          </div>

          {excludeError && (
            <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
              {excludeError}
            </div>
          )}

          <ExcludeEntryList entries={excludes} onRemove={(e) => setRemoveEntry(e)} />
        </div>
      )}

      {/* Dialogs */}
      <RepoEditDialog open={showEdit} onOpenChange={setShowEdit} repo={repo} />

      <AddExcludeDialog
        open={showAddExclude}
        onOpenChange={setShowAddExclude}
        repoId={repo.id}
        repoPath={repo.path}
        existingPatterns={excludes.map((e) => e.pattern)}
        onSubmit={handleAddExclude}
      />

      <RemoveExcludeConfirmDialog
        open={removeEntry !== null}
        onOpenChange={(open) => !open && setRemoveEntry(null)}
        entry={removeEntry}
        onConfirm={handleRemoveExcludeConfirm}
      />

      {/* Remove repo confirm */}
      {showRemoveRepo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowRemoveRepo(false)}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-xl p-5 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-sm font-semibold">{t('detail.removeConfirmTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('detail.removeConfirmBody')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRemoveRepo(false)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
              >
                {tc('actions.cancel')}
              </button>
              <button
                onClick={handleRemoveRepo}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
              >
                {t('detail.removeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
