import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRepoStore } from '@/stores/repo-store'
import { useFileStore } from '@/stores/file-store'
import { RepoList } from '../repos/RepoList'
import { RepoCreateDialog } from '../repos/RepoCreateDialog'
import {
  Plus,
  Search,
  Filter,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ListFilter
} from 'lucide-react'

type SortField = 'name' | 'added' | 'activity' | 'deployments'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | 'withDeployments' | 'withoutDeployments' | 'validGit' | 'invalidPath'

export function ReposSidebarPanel() {
  const { t } = useTranslation('repos')
  const { repos, loading, loadRepos } = useRepoStore()
  const { tags, loadTags } = useFileStore()

  const [search, setSearch] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [filterTagIds, setFilterTagIds] = useState<string[]>([])
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showStatusFilter, setShowStatusFilter] = useState(false)
  const [sortField, setSortField] = useState<SortField>('activity')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showSortMenu, setShowSortMenu] = useState(false)

  const sortRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadRepos()
    loadTags()
  }, [loadRepos, loadTags])

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

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
    setShowSortMenu(false)
  }

  const filtered = repos
    .filter((r) => {
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        r.path.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)

      const matchesTags =
        filterTagIds.length === 0 || r.tags.some((tag) => filterTagIds.includes(tag.id))

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'withDeployments' && r.deploymentCount > 0) ||
        (statusFilter === 'withoutDeployments' && r.deploymentCount === 0) ||
        (statusFilter === 'validGit' && r.isValidGit && r.pathExists) ||
        (statusFilter === 'invalidPath' && (!r.pathExists || !r.isValidGit))

      return matchesSearch && matchesTags && matchesStatus
    })
    .sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.displayName.localeCompare(b.displayName)
          break
        case 'added':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'activity': {
          const aT = a.lastActivity ? new Date(a.lastActivity).getTime() : 0
          const bT = b.lastActivity ? new Date(b.lastActivity).getTime() : 0
          cmp = aT - bT
          break
        }
        case 'deployments':
          cmp = a.deploymentCount - b.deploymentCount
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const statusOptions: StatusFilter[] = [
    'all',
    'withDeployments',
    'withoutDeployments',
    'validGit',
    'invalidPath'
  ]
  const sortFields: SortField[] = ['name', 'added', 'activity', 'deployments']
  const hasActiveFilters =
    search !== '' || filterTagIds.length > 0 || statusFilter !== 'all'

  return (
    <>
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex-1">
            {t('title')}
          </h2>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="p-1 rounded-md hover:bg-secondary transition-colors text-primary"
            title={t('create.title')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search', { ns: 'common', defaultValue: 'Search...' })}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary rounded-md border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Sort */}
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
              title={t('tags.filterByTag', { ns: 'files' })}
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
          <div className="mt-2 p-2 bg-secondary/70 rounded-lg border border-border">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {t('tags.filterByTag', { ns: 'files' })}
              </span>
              {filterTagIds.length > 0 && (
                <button
                  onClick={() => setFilterTagIds([])}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                  {t('tags.clearFilter', { ns: 'files' })}
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

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {t('loading', { ns: 'common', defaultValue: 'Loading...' })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {repos.length === 0 ? t('list.empty') : t('list.noResults')}
            {hasActiveFilters && repos.length > 0 && (
              <button
                onClick={() => {
                  setSearch('')
                  setFilterTagIds([])
                  setStatusFilter('all')
                }}
                className="block mx-auto mt-2 text-xs text-primary hover:underline"
              >
                {t('clearFilters', { ns: 'common', defaultValue: 'Clear filters' })}
              </button>
            )}
          </div>
        ) : (
          <RepoList repos={filtered} />
        )}
      </div>

      <RepoCreateDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </>
  )
}
