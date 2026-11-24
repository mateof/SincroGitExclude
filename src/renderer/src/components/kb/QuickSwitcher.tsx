import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, FileText, Sparkles, LoaderCircle } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import type { KbSearchHit, KbSearchMode } from '../../../../shared/kb/types'

function parseQuery(raw: string): { text: string; tags: string[] } {
  const tags: string[] = []
  const text = raw
    .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, (_m, pre: string, tag: string) => {
      tags.push(tag)
      return pre
    })
    .trim()
  return { text, tags }
}

export function QuickSwitcher() {
  const { t } = useTranslation('kb')
  const { quickOpen, setQuickOpen, spaces, selectedSpaceId, openNote, semantic, loadSemantic } = useKbStore()
  const openKnowledge = useUIStore((s) => s.openKnowledge)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<KbSearchMode>('hybrid')
  const [scope, setScope] = useState<'all' | 'space'>('all')
  const [hits, setHits] = useState<KbSearchHit[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openKnowledge()
        setQuickOpen(!useKbStore.getState().quickOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setQuickOpen, openKnowledge])

  useEffect(() => {
    if (!quickOpen) return
    void loadSemantic()
    const preset = sessionStorage.getItem('kbQuickQuery')
    if (preset) {
      sessionStorage.removeItem('kbQuickQuery')
      setQuery(preset)
    }
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [quickOpen, loadSemantic])

  const semanticReady = semantic?.ready === true
  const effectiveMode: KbSearchMode = semanticReady ? mode : 'text'
  const names = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces])

  useEffect(() => {
    if (!quickOpen) return
    const { text, tags } = parseQuery(query)
    if (!text && tags.length === 0) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setBusy(true)
      setError(null)
      try {
        const spaceIds = scope === 'space' && selectedSpaceId ? [selectedSpaceId] : undefined
        let results: KbSearchHit[]
        if (!text) {
          const recent = await kbCall<Array<{ spaceId: string; path: string; title: string; tags: string[] }>>('kb:recent', {
            spaceIds,
            limit: 200
          })
          results = recent
            .filter((r) => tags.every((tag) => r.tags.some((x) => x.toLowerCase() === tag.toLowerCase() || x.toLowerCase().startsWith(`${tag.toLowerCase()}/`))))
            .slice(0, 30)
            .map((r) => ({ ...r, score: 0, snippet: r.path, matchedBy: [] }))
        } else {
          results = await kbCall<KbSearchHit[]>('kb:search', text, { spaceIds, tags, limit: 30, mode: effectiveMode })
        }
        if (!cancelled) {
          setHits(results)
          setActive(0)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 160)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, effectiveMode, scope, selectedSpaceId, quickOpen])

  if (!quickOpen) return null

  const choose = (hit: KbSearchHit): void => {
    setQuickOpen(false)
    openKnowledge()
    void openNote(hit.spaceId, hit.path, hit.heading?.split(' › ').pop() ?? null)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') setQuickOpen(false)
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(hits.length - 1, a + 1))
      listRef.current?.children[Math.min(hits.length - 1, active + 1)]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
      listRef.current?.children[Math.max(0, active - 1)]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      choose(hits[active])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="fixed inset-0 bg-black/50" onClick={() => setQuickOpen(false)} />
      <div className="relative w-full max-w-2xl mx-4 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 px-4 border-b border-border">
          {busy ? <LoaderCircle className="w-4 h-4 animate-spin text-muted-foreground" /> : <Search className="w-4 h-4 text-muted-foreground" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 py-3.5 bg-transparent outline-none text-sm"
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-[11px]">
          <div className="flex gap-0.5 p-0.5 bg-secondary rounded-md">
            {(['text', 'semantic', 'hybrid'] as KbSearchMode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={m !== 'text' && !semanticReady}
                onClick={() => setMode(m)}
                title={m !== 'text' && !semanticReady ? t('search.semanticOff') : undefined}
                className={`px-2 py-0.5 rounded disabled:opacity-40 ${effectiveMode === m ? 'bg-card shadow text-foreground' : 'text-muted-foreground'}`}
              >
                {t(`search.modes.${m}`)}
              </button>
            ))}
          </div>
          {spaces.length > 1 && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'all' | 'space')}
              className="ml-auto px-2 py-0.5 bg-secondary border border-border rounded-md"
            >
              <option value="all">{t('search.allSpaces')}</option>
              <option value="space">{names.get(selectedSpaceId ?? '') ?? ''}</option>
            </select>
          )}
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
          {error && <p className="px-4 py-3 text-xs text-destructive">{error}</p>}
          {!error && query && !busy && hits.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('search.noResults')}</p>}
          {hits.map((hit, i) => (
            <button
              key={`${hit.spaceId}:${hit.path}`}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(hit)}
              className={`w-full text-left px-4 py-2.5 border-b border-border/60 ${i === active ? 'bg-primary/10' : ''}`}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{hit.title}</span>
                {hit.matchedBy.includes('semantic') && <Sparkles className="w-3 h-3 text-primary shrink-0" />}
                <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[40%]">
                  {spaces.length > 1 ? `${names.get(hit.spaceId)} · ` : ''}
                  {hit.path}
                </span>
              </div>
              {hit.heading && <div className="text-[11px] text-primary/80 mt-0.5 ml-5 truncate">{hit.heading}</div>}
              {hit.snippet && hit.snippet !== hit.path && <div className="text-xs text-muted-foreground mt-0.5 ml-5 line-clamp-2">{hit.snippet}</div>}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border">{t('search.hint')}</div>
      </div>
    </div>
  )
}
