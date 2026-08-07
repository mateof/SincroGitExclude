import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { IpcResult } from '@/types'
import {
  X,
  RefreshCw,
  Trash2,
  FolderOpen,
  Copy,
  Search,
  ScrollText,
  Check,
  ArrowDown
} from 'lucide-react'

interface LogEntry {
  timestamp: string
  level: string
  message: string
}

interface LogViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const LEVEL_STYLES: Record<string, string> = {
  error: 'text-destructive',
  warn: 'text-warning',
  info: 'text-foreground',
  debug: 'text-muted-foreground',
  verbose: 'text-muted-foreground',
  silly: 'text-muted-foreground'
}

const LEVEL_FILTERS = ['all', 'error', 'warn', 'info', 'debug'] as const
type LevelFilter = (typeof LEVEL_FILTERS)[number]

// Anything at or below the selected level is shown (error is the narrowest)
const LEVEL_RANK: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 3,
  silly: 3
}

const LIMITS = [100, 500, 1000, 5000]

/** Quick ranges, counted back from now */
const QUICK_RANGES = [
  { minutes: 15, key: 'range15m' },
  { minutes: 60, key: 'range1h' },
  { minutes: 24 * 60, key: 'range24h' },
  { minutes: 7 * 24 * 60, key: 'range7d' }
]

/** `2026-08-07 10:54:36.326` (electron-log, local time) → Date */
function parseTimestamp(timestamp: string): number {
  return new Date(timestamp.replace(' ', 'T')).getTime()
}

/** Date → value accepted by <input type="datetime-local">, in local time */
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

function formatEntry(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level}] ${entry.message}`
}

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [logPath, setLogPath] = useState('')
  const [verbose, setVerbose] = useState(false)
  const [level, setLevel] = useState<LevelFilter>('all')
  const [limit, setLimit] = useState(500)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [result, info] = await Promise.all([
      window.api.invoke<IpcResult<{ path: string; entries: LogEntry[] }>>('logs:read', limit),
      window.api.invoke<IpcResult<{ verbose: boolean }>>('logs:info')
    ])
    if (result.success && result.data) {
      setEntries(result.data.entries)
      setLogPath(result.data.path)
    }
    // The main process is the source of truth for the active level
    if (info.success && info.data) setVerbose(info.data.verbose)
    setLoading(false)
  }, [limit])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleVerboseChange = async (value: boolean) => {
    setVerbose(value)
    localStorage.setItem('logVerbose', String(value))
    await window.api.invoke('logs:set-verbose', value)
  }

  const handleClear = async () => {
    await window.api.invoke('logs:clear')
    await load()
  }

  const applyQuickRange = (minutes: number) => {
    setFrom(toInputValue(new Date(Date.now() - minutes * 60_000)))
    setTo('')
  }

  const clearRange = () => {
    setFrom('')
    setTo('')
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const fromTime = from ? new Date(from).getTime() : null
    const toTime = to ? new Date(to).getTime() : null

    return entries.filter((e) => {
      if (level !== 'all' && (LEVEL_RANK[e.level] ?? 3) > LEVEL_RANK[level]) return false
      if (needle && !e.message.toLowerCase().includes(needle)) return false
      if (fromTime !== null || toTime !== null) {
        const time = parseTimestamp(e.timestamp)
        if (Number.isNaN(time)) return false
        if (fromTime !== null && time < fromTime) return false
        if (toTime !== null && time > toTime) return false
      }
      return true
    })
  }, [entries, level, search, from, to])

  // Jump to the newest entries: what you almost always want after an error
  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    if (!loading) scrollToBottom()
  }, [loading, filtered.length, scrollToBottom])

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(filtered.map(formatEntry).join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  const handleCopyEntry = async (entry: LogEntry, index: number) => {
    await navigator.clipboard.writeText(formatEntry(entry))
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 2000)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t('logs.title')}</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-secondary"
            title={tc('actions.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar: search, level, how many entries, actions */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-border">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tc('actions.search')}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>

          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as LevelFilter)}
            className="px-2 py-1.5 text-xs bg-secondary rounded-lg border border-border outline-none focus:ring-1 focus:ring-primary"
          >
            {LEVEL_FILTERS.map((l) => (
              <option key={l} value={l}>
                {t(`logs.levels.${l}`)}
              </option>
            ))}
          </select>

          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-2 py-1.5 text-xs bg-secondary rounded-lg border border-border outline-none focus:ring-1 focus:ring-primary"
            title={t('logs.limitHint')}
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {t('logs.lastEntries', { n })}
              </option>
            ))}
          </select>

          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors disabled:opacity-50"
            title={tc('actions.refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleCopyAll}
            className="p-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors"
            title={t('logs.copy')}
          >
            {copiedAll ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            onClick={scrollToBottom}
            className="p-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors"
            title={t('logs.jumpToEnd')}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => window.api.invoke('logs:open-folder')}
            className="p-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors"
            title={t('logs.openFolder')}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleClear}
            className="p-1.5 rounded-lg bg-secondary hover:bg-destructive/10 hover:text-destructive transition-colors"
            title={t('logs.clear')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer pl-1">
            <input
              type="checkbox"
              checked={verbose}
              onChange={(e) => handleVerboseChange(e.target.checked)}
              className="accent-primary"
            />
            <span title={t('logs.verboseHint')}>{t('logs.verbose')}</span>
          </label>
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-2 border-b border-border">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('logs.range')}
          </span>

          {QUICK_RANGES.map((range) => (
            <button
              key={range.key}
              onClick={() => applyQuickRange(range.minutes)}
              className="px-2 py-1 text-[11px] rounded-md bg-secondary hover:bg-muted transition-colors"
            >
              {t(`logs.${range.key}`)}
            </button>
          ))}

          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 text-[11px] bg-secondary rounded-lg border border-border outline-none focus:ring-1 focus:ring-primary"
            title={t('logs.from')}
          />
          <span className="text-[11px] text-muted-foreground">→</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 text-[11px] bg-secondary rounded-lg border border-border outline-none focus:ring-1 focus:ring-primary"
            title={t('logs.to')}
          />

          {(from || to) && (
            <button
              onClick={clearRange}
              className="px-2 py-1 text-[11px] rounded-md hover:bg-secondary text-muted-foreground transition-colors"
            >
              {t('logs.clearRange')}
            </button>
          )}
        </div>

        {/* Entries — selectable so a fragment can be copied by hand */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-5 py-3 font-mono text-[11px] leading-relaxed select-text"
        >
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-xs font-sans">
              {t('logs.empty')}
            </div>
          ) : (
            filtered.map((entry, i) => (
              <div
                key={i}
                className="group flex gap-2 py-0.5 border-b border-border/30 hover:bg-secondary/40"
              >
                <span className="text-muted-foreground/60 shrink-0">{entry.timestamp}</span>
                <span
                  className={`shrink-0 w-12 uppercase ${
                    LEVEL_STYLES[entry.level] ?? 'text-muted-foreground'
                  }`}
                >
                  {entry.level}
                </span>
                <span
                  className={`flex-1 whitespace-pre-wrap break-all ${
                    LEVEL_STYLES[entry.level] ?? ''
                  }`}
                >
                  {entry.message}
                </span>
                <button
                  onClick={() => handleCopyEntry(entry, i)}
                  className="shrink-0 self-start p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
                  title={t('logs.copyEntry')}
                >
                  {copiedIndex === i ? (
                    <Check className="w-3 h-3 text-success" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[10px] text-muted-foreground truncate select-text" title={logPath}>
            {logPath}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {t('logs.count', { shown: filtered.length, total: entries.length })}
          </span>
        </div>
      </div>
    </div>
  )
}
