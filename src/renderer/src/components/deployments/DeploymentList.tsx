import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentStore } from '@/stores/deployment-store'
import { useFileStore } from '@/stores/file-store'
import type { Deployment } from '@/types'
import { DeploymentCard } from './DeploymentCard'
import { DeploymentCreateDialog } from './DeploymentCreateDialog'
import {
  Plus,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  ListFilter,
  X
} from 'lucide-react'

export interface CreateSource {
  deploymentId?: string
  commitHash?: string
}

type DeploySortField = 'path' | 'created' | 'modified'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive' | 'hasChanges' | 'excluded' | 'notExcluded'

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
  const { t: tc } = useTranslation('common')
  const { deployments, loading, loadDeployments } = useDeploymentStore()
  const { tags } = useFileStore()

  const [search, setSearch] = useState('')
  const [filterTagIds, setFilterTagIds] = useState<string[]>([])
  const [sortField, setSortField] = useState<DeploySortField>('created')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showStatusFilter, setShowStatusFilter] = useState(false)

  const sortRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadDeployments(fileId)
  }, [fileId, loadDeployments])

  // Close sort menu on outside click
  useEffect(() => {
    if (!showSortMenu) return
    const handleClick = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSortMenu])

  // Close status filter on outside click
  useEffect(() => {
    if (!showStatusFilter) return
    const handleClick = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setShowStatusFilter(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showStatusFilter])

  const toggleFilterTag = (tagId: string) => {
    setFilterTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const toggleSort = (field: DeploySortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'path' ? 'asc' : 'desc')
    }
    setShowSortMenu(false)
  }

  const filtered = deployments
    .filter((d) => {
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        d.repoPath.toLowerCase().includes(q) ||
        d.fileRelativePath.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q)

      const matchesTags =
        filterTagIds.length === 0 || d.tags.some((tag) => filterTagIds.includes(tag.id))

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && d.isActive) ||
        (statusFilter === 'inactive' && !d.isActive) ||
        (statusFilter === 'hasChanges' && d.hasChanges) ||
        (statusFilter === 'excluded' && d.isExcluded) ||
        (statusFilter === 'notExcluded' && d.isExcluded === false)

      return matchesSearch && matchesTags && matchesStatus
    })
    .sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'path':
          cmp = a.fileRelativePath.localeCompare(b.fileRelativePath)
          break
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'modified':
          cmp =
            new Date(a.lastSyncedAt ?? a.createdAt).getTime() -
            new Date(b.lastSyncedAt ?? b.createdAt).getTime()
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const sortFields: DeploySortField[] = ['path', 'created', 'modified']
  const statusOptions: StatusFilter[] = [
    'all',
    'active',
    'inactive',
    'hasChanges',
    'excluded',
    'notExcluded'
  ]

  const hasActiveFilters = filterTagIds.length > 0 || statusFilter !== 'all' || search !== ''

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <button
          onClick={() => onCreateSourceChange({})}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('createTitle')}
        </button>
      </div>

      {/* Search + filter bar */}
      {deployments.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search.placeholder')}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary rounded-md border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Sort dropdown */}
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => {
                  setShowSortMenu(!showSortMenu)
                  setShowTagFilter(false)
                  setShowStatusFilter(false)
                }}
                className="p-1.5 rounded-md transition-colors shrink-0 bg-secondary text-muted-foreground hover:text-foreground"
                title={t('sort.label')}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                  {sortFields.map((field) => {
                    const active = sortField === field
                    return (
                      <button
                        key={field}
                        onClick={() => toggleSort(field)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`}
                      >
                        <span>{t(`sort.${field}`)}</span>
                        {active &&
                          (sortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          ))}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Tag filter */}
            {tags.length > 0 && (
              <button
                onClick={() => {
                  setShowTagFilter(!showTagFilter)
                  setShowSortMenu(false)
                  setShowStatusFilter(false)
                }}
                className={`p-1.5 rounded-md transition-colors shrink-0 ${
                  filterTagIds.length > 0
                    ? 'bg-primary/15 text-primary'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                title={t('tags.filterByTag')}
              >
                <Filter className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Status filter */}
            <div className="relative" ref={statusRef}>
              <button
                onClick={() => {
                  setShowStatusFilter(!showStatusFilter)
                  setShowSortMenu(false)
                  setShowTagFilter(false)
                }}
                className={`p-1.5 rounded-md transition-colors shrink-0 ${
                  statusFilter !== 'all'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                title={t('filter.label')}
              >
                <ListFilter className="w-3.5 h-3.5" />
              </button>
              {showStatusFilter && (
                <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                  {statusOptions.map((opt) => {
                    const active = statusFilter === opt
                    return (
                      <button
                        key={opt}
                        onClick={() => {
                          setStatusFilter(opt)
                          setShowStatusFilter(false)
                        }}
                        className={`w-full flex items-center px-3 py-1.5 text-xs transition-colors ${
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`}
                      >
                        {t(`filter.${opt}`)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Tag filter dropdown */}
          {showTagFilter && (
            <div className="p-2 bg-secondary/70 rounded-lg border border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t('tags.filterByTag')}
                </span>
                {filterTagIds.length > 0 && (
                  <button
                    onClick={() => setFilterTagIds([])}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                  >
                    <X className="w-2.5 h-2.5" />
                    {t('tags.clearFilter')}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => {
                  const active = filterTagIds.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleFilterTag(tag.id)}
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
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
      ) : deployments.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t('messages.noDeployments')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          {tc('noResults', { defaultValue: 'No results' })}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch('')
                setFilterTagIds([])
                setStatusFilter('all')
              }}
              className="block mx-auto mt-2 text-xs text-primary hover:underline"
            >
              {t('filter.clearFilter')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
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
        onOpenChange={(open) => {
          if (!open) onCreateSourceChange(null)
        }}
        fileId={fileId}
        sourceDeploymentId={createSource?.deploymentId}
        sourceCommitHash={createSource?.commitHash}
      />
    </div>
  )
}
