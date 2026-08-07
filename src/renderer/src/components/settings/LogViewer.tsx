import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Check
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

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [logPath, setLogPath] = useState('')
  const [verbose, setVerbose] = useState(() => localStorage.getItem('logVerbose') === 'true')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [result, info] = await Promise.all([
      window.api.invoke<IpcResult<{ path: string; entries: LogEntry[] }>>('logs:read', 1000),
      window.api.invoke<IpcResult<{ verbose: boolean }>>('logs:info')
    ])
    if (result.success && result.data) {
      setEntries(result.data.entries)
      setLogPath(result.data.path)
    }
    // The main process is the source of truth for the active level
    if (info.success && info.data) setVerbose(info.data.verbose)
    setLoading(false)
  }, [])

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (level !== 'all' && (LEVEL_RANK[e.level] ?? 3) > LEVEL_RANK[level]) return false
      if (needle && !e.message.toLowerCase().includes(needle)) return false
      return true
    })
  }, [entries, level, search])

  const handleCopy = async () => {
    const text = filtered.map((e) => `[${e.timestamp}] [${e.level}] ${e.message}`).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
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

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border">
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

          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors disabled:opacity-50"
            title={tc('actions.refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors"
            title={t('logs.copy')}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
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

        {/* Entries */}
        <div className="flex-1 overflow-y-auto px-5 py-3 font-mono text-[11px] leading-relaxed">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-xs font-sans">
              {t('logs.empty')}
            </div>
          ) : (
            filtered.map((entry, i) => (
              <div key={i} className="flex gap-2 py-0.5 border-b border-border/30">
                <span className="text-muted-foreground/60 shrink-0">{entry.timestamp}</span>
                <span
                  className={`shrink-0 w-12 uppercase ${
                    LEVEL_STYLES[entry.level] ?? 'text-muted-foreground'
                  }`}
                >
                  {entry.level}
                </span>
                <span
                  className={`whitespace-pre-wrap break-all ${
                    LEVEL_STYLES[entry.level] ?? ''
                  }`}
                >
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[10px] text-muted-foreground truncate" title={logPath}>
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
