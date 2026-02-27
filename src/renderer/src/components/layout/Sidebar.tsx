import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import { useUIStore } from '@/stores/ui-store'
import { useWatcherStore } from '@/stores/watcher-store'
import { FileList } from '../files/FileList'
import { FileCreateDialog } from '../files/FileCreateDialog'
import { Plus, Search, Filter, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

type SortField = 'name' | 'alias' | 'created' | 'modified'
type SortDir = 'asc' | 'desc'

export function Sidebar() {
  const { t } = useTranslation('files')
  const { files, tags, loading, loadFiles, loadTags } = useFileStore()
  const { sidebarOpen } = useUIStore()
  const [search, setSearch] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [filterTagIds, setFilterTagIds] = useState<string[]>([])
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [sortField, setSortField] = useState<SortField>('modified')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)
  const { changedFileIds, refreshChangedFileIds } = useWatcherStore()

  useEffect(() => {
    loadFiles()
    loadTags()
    refreshChangedFileIds()
  }, [loadFiles, loadTags])

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

  if (!sidebarOpen) return null

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
      setSortDir(field === 'name' || field === 'alias' ? 'asc' : 'desc')
    }
    setShowSortMenu(false)
  }

  const filteredFiles = files
    .filter((f) => {
      const matchesSearch =
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.alias.toLowerCase().includes(search.toLowerCase())

      const matchesTags =
        filterTagIds.length === 0 ||
        f.tags.some((tag) => filterTagIds.includes(tag.id))

      return matchesSearch && matchesTags
    })
    .sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'alias':
          cmp = a.alias.localeCompare(b.alias)
          break
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'modified':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  return (
    <aside className="w-64 border-r border-border flex flex-col bg-card/50 shrink-0">
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider flex-1">
            {t('title')}
          </h2>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="p-1 rounded-md hover:bg-secondary transition-colors text-primary"
            title={t('createTitle')}
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
          <div className="relative" ref={sortRef}>
            <button
              onClick={() => { setShowSortMenu(!showSortMenu); setShowTagFilter(false) }}
              className="p-1.5 rounded-md transition-colors shrink-0 bg-secondary text-muted-foreground hover:text-foreground"
              title={t('sort.label')}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                {(['name', 'alias', 'created', 'modified'] as SortField[]).map((field) => {
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
                      {active && (
                        sortDir === 'asc'
                          ? <ArrowUp className="w-3 h-3" />
                          : <ArrowDown className="w-3 h-3" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {tags.length > 0 && (
            <button
              onClick={() => { setShowTagFilter(!showTagFilter); setShowSortMenu(false) }}
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
        </div>

        {/* Tag filter dropdown */}
        {showTagFilter && (
          <div className="mt-2 p-2 bg-secondary/70 rounded-lg border border-border">
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

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {t('loading', { ns: 'common', defaultValue: 'Loading...' })}
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {files.length === 0
              ? t('messages.noFiles')
              : t('noResults', { ns: 'common', defaultValue: 'No results' })}
          </div>
        ) : (
          <FileList files={filteredFiles} changedFileIds={changedFileIds} />
        )}
      </div>

      <FileCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </aside>
  )
}
