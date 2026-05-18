import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  FolderOpen,
  AlertTriangle,
  Plus,
  Check,
  Ban,
  FileQuestion,
  XCircle,
  Asterisk,
  CaseSensitive
} from 'lucide-react'

interface SelectExcludeTargetsResult {
  patterns: string[]
  outsideRepo: string[]
}

interface ValidationResult {
  isOutsideRepo: boolean
  exists: boolean
  isDirectory: boolean
  isGlob: boolean
  caseMismatch: boolean
  actualName: string | null
  fsCaseInsensitive: boolean
}

interface PendingEntry {
  pattern: string
  validation: ValidationResult | null
}

type EntryStatus =
  | 'new'
  | 'newNotFound'
  | 'newGlob'
  | 'newCaseMismatch'
  | 'alreadyInFile'
  | 'alreadyInFileCaseInsensitive'
  | 'outsideRepo'

interface AddExcludeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: string
  repoPath: string
  existingPatterns: string[]
  onSubmit: (patterns: string[]) => Promise<void>
}

const ADDABLE: ReadonlySet<EntryStatus> = new Set([
  'new',
  'newNotFound',
  'newGlob',
  'newCaseMismatch'
])

function computeStatus(
  entry: PendingEntry,
  existingPatterns: string[],
  existingLowerMap: Map<string, string>
): EntryStatus {
  const trimmed = entry.pattern.trim()
  if (existingPatterns.includes(trimmed)) return 'alreadyInFile'
  if (entry.validation?.fsCaseInsensitive) {
    const match = existingLowerMap.get(trimmed.toLowerCase())
    if (match) return 'alreadyInFileCaseInsensitive'
  }
  if (!entry.validation) return 'new'
  if (entry.validation.isOutsideRepo) return 'outsideRepo'
  if (entry.validation.isGlob) return 'newGlob'
  if (entry.validation.exists) {
    return entry.validation.caseMismatch ? 'newCaseMismatch' : 'new'
  }
  return 'newNotFound'
}

export function AddExcludeDialog({
  open,
  onOpenChange,
  repoId,
  repoPath,
  existingPatterns,
  onSubmit
}: AddExcludeDialogProps) {
  const { t } = useTranslation('repos')
  const { t: tc } = useTranslation('common')

  const [pending, setPending] = useState<PendingEntry[]>([])
  const [manualInput, setManualInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [outsideWarning, setOutsideWarning] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const existingLowerMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of existingPatterns) {
      const trimmed = p.trim()
      m.set(trimmed.toLowerCase(), trimmed)
    }
    return m
  }, [existingPatterns])

  const statuses = useMemo<EntryStatus[]>(
    () => pending.map((e) => computeStatus(e, existingPatterns, existingLowerMap)),
    [pending, existingPatterns, existingLowerMap]
  )

  const newCount = statuses.filter((s) => ADDABLE.has(s)).length
  const skippedCount = pending.length - newCount

  const close = () => {
    setPending([])
    setManualInput('')
    setError(null)
    setOutsideWarning([])
    setLoading(false)
    onOpenChange(false)
  }

  const validateAndAdd = async (
    patterns: string[],
    prevalidated?: Record<string, ValidationResult>
  ) => {
    if (patterns.length === 0) return

    // Add immediately with null validation, then fill in async
    setPending((prev) => {
      const existingPatternsInList = new Set(prev.map((e) => e.pattern))
      const fresh: PendingEntry[] = []
      for (const p of patterns) {
        if (existingPatternsInList.has(p)) continue
        const pre = prevalidated?.[p]
        fresh.push({ pattern: p, validation: pre ?? null })
      }
      return [...prev, ...fresh]
    })

    // Async-validate any that didn't come pre-validated
    const toValidate = patterns.filter((p) => !prevalidated?.[p])
    for (const p of toValidate) {
      const result = await window.api.invoke<{
        success: boolean
        data?: ValidationResult
      }>('repos:validate-pattern', repoId, p)
      if (result.success && result.data) {
        const validation = result.data
        setPending((prev) =>
          prev.map((e) => (e.pattern === p ? { ...e, validation } : e))
        )
      }
    }
  }

  const handleManualAdd = async () => {
    const trimmed = manualInput.trim()
    if (!trimmed) return
    setManualInput('')
    await validateAndAdd([trimmed])
  }

  const handleManualKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleManualAdd()
    }
  }

  const handleBrowse = async () => {
    setError(null)
    setOutsideWarning([])
    const result = await window.api.invoke<SelectExcludeTargetsResult | null>(
      'dialog:select-exclude-targets',
      repoPath
    )
    if (!result) return
    if (result.outsideRepo.length > 0) {
      setOutsideWarning(result.outsideRepo)
    }
    if (result.patterns.length > 0) {
      // Browse paths are real and inside the repo; still hit IPC for the
      // case-mismatch + fsCaseInsensitive info so the status badge is accurate.
      await validateAndAdd(result.patterns)
    }
  }

  const removePending = (index: number) => {
    setPending((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    const toAdd = pending
      .filter((_, i) => ADDABLE.has(statuses[i]))
      .map((e) => e.pattern)
    if (toAdd.length === 0) return
    setLoading(true)
    setError(null)
    try {
      await onSubmit(toAdd)
      close()
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  if (!open) return null

  const renderStatusBadge = (status: EntryStatus, entry: PendingEntry) => {
    switch (status) {
      case 'new':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success font-medium">
            {entry.validation?.isDirectory
              ? t('exclude.statusNewDir')
              : t('exclude.statusNew')}
          </span>
        )
      case 'newGlob':
        return (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium"
            title={t('exclude.statusGlobHint')}
          >
            {t('exclude.statusGlob')}
          </span>
        )
      case 'newNotFound':
        return (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium"
            title={t('exclude.statusNotFoundHint')}
          >
            {t('exclude.statusNotFound')}
          </span>
        )
      case 'newCaseMismatch':
        return (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium font-mono"
            title={t('exclude.statusCaseMismatchHint', {
              actual: entry.validation?.actualName ?? ''
            })}
          >
            {t('exclude.statusCaseMismatch', {
              actual: entry.validation?.actualName ?? ''
            })}
          </span>
        )
      case 'alreadyInFile':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium">
            {t('exclude.statusAlreadyInFile')}
          </span>
        )
      case 'alreadyInFileCaseInsensitive':
        return (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium"
            title={t('exclude.statusAlreadyInFileCaseInsensitiveHint', {
              existing:
                existingLowerMap.get(entry.pattern.trim().toLowerCase()) ?? ''
            })}
          >
            {t('exclude.statusAlreadyInFileCaseInsensitive')}
          </span>
        )
      case 'outsideRepo':
        return (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium"
            title={t('exclude.statusOutsideRepoHint')}
          >
            {t('exclude.statusOutsideRepo')}
          </span>
        )
    }
  }

  const renderStatusIcon = (status: EntryStatus) => {
    switch (status) {
      case 'new':
        return <Check className="w-3.5 h-3.5 text-success shrink-0" />
      case 'newGlob':
        return <Asterisk className="w-3.5 h-3.5 text-primary shrink-0" />
      case 'newNotFound':
        return <FileQuestion className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      case 'newCaseMismatch':
        return <CaseSensitive className="w-3.5 h-3.5 text-warning shrink-0" />
      case 'alreadyInFile':
        return <Ban className="w-3.5 h-3.5 text-warning shrink-0" />
      case 'alreadyInFileCaseInsensitive':
        return <Ban className="w-3.5 h-3.5 text-warning shrink-0" />
      case 'outsideRepo':
        return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={close} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl p-5 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">{t('exclude.addTitle')}</h3>
          <button
            onClick={close}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Pending entries list */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('exclude.pendingLabel')}
              {pending.length > 0 && (
                <span className="ml-1.5 text-muted-foreground/60">
                  ({pending.length})
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={handleBrowse}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs border border-border rounded-md hover:bg-secondary transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t('create.browse')}
            </button>
          </div>

          {pending.length === 0 ? (
            <div className="px-2.5 py-3 text-center text-[11px] text-muted-foreground bg-secondary/40 border border-dashed border-border rounded-md">
              {t('exclude.pendingEmpty')}
            </div>
          ) : (
            <div className="border border-border rounded-md bg-secondary/30 max-h-48 overflow-y-auto divide-y divide-border">
              {pending.map((entry, i) => {
                const status = statuses[i]
                return (
                  <div
                    key={`${entry.pattern}-${i}`}
                    className="flex items-center gap-2 px-2.5 py-1.5 group"
                  >
                    {renderStatusIcon(status)}
                    <code className="text-xs font-mono flex-1 truncate" title={entry.pattern}>
                      {entry.pattern}
                    </code>
                    {renderStatusBadge(status, entry)}
                    <button
                      type="button"
                      onClick={() => removePending(i)}
                      className="shrink-0 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                      title={tc('actions.remove', { defaultValue: 'Remove' })}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Manual input */}
        <div className="mb-3">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={handleManualKeyDown}
              placeholder={t('exclude.patternPlaceholder')}
              className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={handleManualAdd}
              disabled={!manualInput.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-secondary disabled:opacity-50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t('exclude.patternHint')}
          </p>
        </div>

        {/* Outside-repo warning (from native dialog) */}
        {outsideWarning.length > 0 && (
          <div className="mb-3 px-2.5 py-1.5 bg-warning/10 border border-warning/30 rounded-md text-xs text-warning">
            <div className="flex items-center gap-1.5 font-medium mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('exclude.outsideRepoWarning', { count: outsideWarning.length })}
            </div>
            <ul className="text-[10px] font-mono space-y-0.5 max-h-20 overflow-y-auto">
              {outsideWarning.map((p) => (
                <li key={p} className="truncate">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mb-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2.5 py-1.5">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2">
          <span className="text-[11px] text-muted-foreground mr-auto">
            {pending.length > 0 && (
              <>
                {t('exclude.summaryNew', { count: newCount })}
                {skippedCount > 0 && (
                  <>
                    {' · '}
                    {t('exclude.summarySkipped', { count: skippedCount })}
                  </>
                )}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            {tc('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={newCount === 0 || loading}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {newCount > 0
              ? t('exclude.addNCount', { count: newCount })
              : t('exclude.addEntry')}
          </button>
        </div>
      </div>
    </div>
  )
}
