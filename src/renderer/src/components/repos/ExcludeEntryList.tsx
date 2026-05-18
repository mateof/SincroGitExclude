import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExcludeEntry } from '@/types'
import { ExcludeEntryRow } from './ExcludeEntryRow'
import { Search } from 'lucide-react'

interface ExcludeEntryListProps {
  entries: ExcludeEntry[]
  onRemove: (entry: ExcludeEntry) => void
}

export function ExcludeEntryList({ entries, onRemove }: ExcludeEntryListProps) {
  const { t } = useTranslation('repos')
  const [search, setSearch] = useState('')

  const filtered = entries.filter((e) =>
    e.pattern.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search', { ns: 'common', defaultValue: 'Search...' })}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary rounded-md border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
          />
        </div>
      </div>
      <div className="divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {entries.length === 0 ? t('exclude.empty') : t('list.noResults')}
          </div>
        ) : (
          filtered.map((entry) => (
            <ExcludeEntryRow key={entry.lineNumber} entry={entry} onRemove={onRemove} />
          ))
        )}
      </div>
    </div>
  )
}
