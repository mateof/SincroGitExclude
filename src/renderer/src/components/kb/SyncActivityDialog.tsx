import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, Copy, ExternalLink, GitCommitHorizontal, GitMerge, History, LoaderCircle, X } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { copyText } from '@/lib/clipboard'
import { dateTime, relativeTime } from '@/lib/relative-time'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { SyncLists, SyncTotals } from './SyncDetails'
import type {
  KbFileChange,
  KbGitCommit,
  KbGitCommitDetail,
  KbGitOverview,
  KbSpace,
  KbSyncActivity,
  KbSyncLogEntry
} from '../../../../shared/kb/types'

export type ActivityTarget = { tab: 'commits'; commit: string } | { tab: 'syncs'; entry?: number }

const PAGE = 30
const MAX_DIFF_LINES = 3000

function Spinner() {
  return (
    <div className="p-4 text-muted-foreground">
      <LoaderCircle className="w-4 h-4 animate-spin" />
    </div>
  )
}

function CommitFile({ space, commit, file, onOpenNote }: { space: KbSpace; commit: string; file: KbFileChange; onOpenNote: (path: string) => void }) {
  const { t } = useTranslation('kb')
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const binary = file.added === null
  const tooBig = (file.added ?? 0) + (file.removed ?? 0) > MAX_DIFF_LINES

  useEffect(() => {
    if (!open || binary || tooBig || diff !== null) return
    let current = true
    kbCall<string>('kb:note-diff', space.id, file.path, commit)
      .then((text) => current && setDiff(text))
      .catch((e: Error) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [open, binary, tooBig, diff, space.id, file.path, commit])

  const color = { added: 'text-success', modified: 'text-primary', deleted: 'text-destructive' }[file.status]
  return (
    <details className="rounded-lg border border-border" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer px-3 py-2 text-xs flex items-center gap-2">
        <span className={`shrink-0 text-[10px] ${color}`}>{t(`sync.file.${file.status}`)}</span>
        <span className="font-mono break-all flex-1">{file.path}</span>
        {!binary && (
          <span className="shrink-0 tabular-nums text-[10px]">
            <span className="text-success">{`+${file.added ?? 0}`}</span> <span className="text-destructive">{`-${file.removed ?? 0}`}</span>
          </span>
        )}
      </summary>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {file.status !== 'deleted' && file.path.endsWith('.md') && (
            <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => onOpenNote(file.path)}>
              {t('sync.openNote')}
            </button>
          )}
          {binary && <p className="text-xs text-muted-foreground">{t('sync.binary')}</p>}
          {tooBig && <p className="text-xs text-muted-foreground">{t('sync.tooBig')}</p>}
          {error && <p className="text-xs text-destructive select-text">{error}</p>}
          {!binary && !tooBig && !error && diff === null && <Spinner />}
          {diff !== null && (
            <div className="select-text">
              <DiffViewer unifiedDiff={diff} format="line-by-line" />
            </div>
          )}
        </div>
      )}
    </details>
  )
}

function CommitPane({ space, git, hash, onOpenNote }: { space: KbSpace; git: KbGitOverview; hash: string; onOpenNote: (path: string) => void }) {
  const { t, i18n } = useTranslation('kb')
  const [detail, setDetail] = useState<KbGitCommitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let current = true
    setDetail(null)
    setError(null)
    setCopied(false)
    kbCall<KbGitCommitDetail>('kb:git-commit', space.id, hash)
      .then((d) => current && setDetail(d))
      .catch((e: Error) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [space.id, hash])

  if (error) return <p className="text-xs text-destructive select-text">{error}</p>
  if (!detail) return <Spinner />
  return (
    <div className="space-y-3">
      <div className="space-y-1 select-text">
        <div className="text-sm font-semibold break-words">{detail.subject}</div>
        {detail.body && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{detail.body}</p>}
        <div className="text-xs text-muted-foreground">
          {detail.author} &lt;{detail.email}&gt; · {dateTime(detail.date, i18n.language)}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground"
            onClick={() => void copyText(detail.hash).then(setCopied)}
            title={t('sync.copyHash')}
          >
            {detail.hash.slice(0, 12)}
            {copied ? <CircleCheck className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
          <span className={`kb-badge ${detail.pushed ? 'kb-badge-success' : 'kb-badge-warning'}`}>
            {t(detail.pushed ? 'sync.pushedCommit' : 'sync.notPushed')}
          </span>
          {detail.merge && (
            <span className="kb-badge">
              <GitMerge className="w-3 h-3" />
              {t('sync.merge')}
            </span>
          )}
          {detail.pushed && git.remote?.commitBase && (
            <a
              href={`${git.remote.commitBase}${detail.hash}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t('sync.openCommit')}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{t('sync.filesChanged', { count: detail.fileCount })}</div>
      <div className="space-y-1.5">
        {detail.files.map((file) => (
          <CommitFile key={`${hash}:${file.path}`} space={space} commit={hash} file={file} onOpenNote={onOpenNote} />
        ))}
      </div>
    </div>
  )
}

function Commits({ space, git, initial, onOpenNote }: { space: KbSpace; git: KbGitOverview; initial?: string; onOpenNote: (path: string) => void }) {
  const { t, i18n } = useTranslation('kb')
  const [commits, setCommits] = useState<KbGitCommit[] | null>(null)
  const [selected, setSelected] = useState<string | null>(initial ?? null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headHash = git.head?.hash

  useEffect(() => {
    let current = true
    kbCall<KbGitCommit[]>('kb:git-commits', space.id, PAGE, 0)
      .then((list) => {
        if (!current) return
        setCommits(list)
        setMore(list.length === PAGE)
        setSelected((s) => s ?? list[0]?.hash ?? null)
      })
      .catch((e: Error) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [space.id, headHash])

  const loadMore = async (): Promise<void> => {
    setLoadingMore(true)
    try {
      const list = await kbCall<KbGitCommit[]>('kb:git-commits', space.id, PAGE, commits?.length ?? 0)
      setCommits((prev) => {
        const known = new Set(prev?.map((c) => c.hash))
        return [...(prev ?? []), ...list.filter((c) => !known.has(c.hash))]
      })
      setMore(list.length === PAGE)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex flex-1 min-h-0">
      <div className="w-80 shrink-0 border-r border-border overflow-y-auto">
        {error && <p className="p-4 text-xs text-destructive select-text">{error}</p>}
        {commits === null && !error && <Spinner />}
        {commits?.length === 0 && <p className="p-4 text-xs text-muted-foreground">{t('sync.noCommits')}</p>}
        {commits?.map((c) => {
          const Icon = c.merge ? GitMerge : GitCommitHorizontal
          return (
            <button
              key={c.hash}
              type="button"
              onClick={() => setSelected(c.hash)}
              className={`w-full text-left px-3 py-2 border-b border-border text-xs hover:bg-secondary ${selected === c.hash ? 'bg-primary/10' : ''}`}
            >
              <div className="font-medium flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{c.subject}</span>
              </div>
              <div className="text-muted-foreground mt-0.5">
                {c.author} · {relativeTime(c.date, i18n.language)} · <span className="font-mono">{c.hash.slice(0, 8)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {c.files.length > 0 && c.files[0].path}
                {c.fileCount > 1 && ` ${t('sync.more', { count: c.fileCount - 1 })}`}
                {!c.pushed && <span className="text-warning"> {t('sync.notPushed')}</span>}
              </div>
            </button>
          )
        })}
        {more && (
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="w-full p-3 text-xs text-primary hover:underline disabled:opacity-50">
            {t('sync.loadMore')}
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-4">
        {selected && <CommitPane space={space} git={git} hash={selected} onOpenNote={onOpenNote} />}
      </div>
    </div>
  )
}

function SyncEntry({ entry, space, open, onOpenNote }: { entry: KbSyncLogEntry; space: KbSpace; open: boolean; onOpenNote: (path: string) => void }) {
  const { t, i18n } = useTranslation('kb')
  const { report } = entry
  const ok = report.ok && !report.blockedBy
  const movedSomething = Object.values(entry.totals).some((n) => n > 0)
  const commits = [
    report.commitsPulled ? t('sync.commitsPulled', { count: report.commitsPulled }) : null,
    report.commitsPushed ? t('sync.commitsPushed', { count: report.commitsPushed }) : null
  ].filter(Boolean)
  return (
    <details className="rounded-lg border border-border" open={open}>
      <summary className="cursor-pointer px-3 py-2 text-xs space-y-0.5">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {ok ? <CircleCheck className="w-3.5 h-3.5 text-success" /> : <CircleAlert className="w-3.5 h-3.5 text-warning" />}
          <span className="font-medium">{dateTime(entry.at, i18n.language)}</span>
          <span className="text-muted-foreground">· {t(`sync.trigger.${entry.trigger}`)}</span>
          {entry.repeats > 1 && (
            <span className="kb-badge kb-badge-warning">
              {t('sync.repeats', { count: entry.repeats, date: dateTime(entry.firstAt, i18n.language) })}
            </span>
          )}
        </span>
        <div className={ok ? '' : 'text-warning'}>
          {!ok && (report.blockedBy ? t(`sync.blocked.${report.blockedBy}`) : t('sync.failed'))}
          {ok && !movedSomething && t('sync.recovered')}
        </div>
        {movedSomething && <SyncTotals totals={entry.totals} />}
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {report.message && <p className="text-xs text-muted-foreground select-text break-words">{report.message}</p>}
        <SyncLists report={report} backend={space.backend} totals={entry.totals} open onOpenNote={onOpenNote} />
        <div className="text-[11px] text-muted-foreground">
          {[...commits, t('sync.duration', { seconds: (entry.durationMs / 1000).toFixed(1) })].join(' · ')}
        </div>
      </div>
    </details>
  )
}

function Syncs({ space, initial, onOpenNote }: { space: KbSpace; initial?: number; onOpenNote: (path: string) => void }) {
  const { t } = useTranslation('kb')
  const [activity, setActivity] = useState<KbSyncActivity | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    kbCall<KbSyncActivity>('kb:sync-activity', space.id, 200)
      .then((a) => current && setActivity(a))
      .catch((e: Error) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [space.id, space.lastSyncAt])

  if (error) return <p className="p-4 text-xs text-destructive select-text">{error}</p>
  if (!activity) return <Spinner />
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      <p className="text-xs text-muted-foreground">{t('sync.logHint')}</p>
      {activity.entries.length === 0 && <p className="text-xs text-muted-foreground">{t('sync.noSyncs')}</p>}
      {activity.entries.map((entry) => (
        <SyncEntry key={entry.id} entry={entry} space={space} open={entry.id === initial} onOpenNote={onOpenNote} />
      ))}
    </div>
  )
}

export function SyncActivityDialog({
  space,
  git,
  target,
  onClose
}: {
  space: KbSpace
  git: KbGitOverview | null
  target: ActivityTarget
  onClose: () => void
}) {
  const { t } = useTranslation('kb')
  const openNote = useKbStore((s) => s.openNote)
  const [tab, setTab] = useState<ActivityTarget['tab']>(target.tab)
  const open = useCallback(
    (path: string) => {
      onClose()
      void openNote(space.id, path)
    },
    [onClose, openNote, space.id]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs: Array<ActivityTarget['tab']> = git ? ['syncs', 'commits'] : ['syncs']
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('sync.activityTitle', { name: space.name })}
        className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-6xl h-[80vh] mx-4 flex flex-col"
      >
        <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('sync.activityTitle', { name: space.name })}</span>
          </h2>
          <div className="flex gap-1">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-2.5 py-1 text-xs rounded-md ${tab === key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary'}`}
              >
                {t(`sync.tab.${key}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        {tab === 'commits' && git ? (
          <Commits space={space} git={git} initial={target.tab === 'commits' ? target.commit : undefined} onOpenNote={open} />
        ) : (
          <Syncs space={space} initial={target.tab === 'syncs' ? target.entry : undefined} onOpenNote={open} />
        )}
      </div>
    </div>
  )
}
