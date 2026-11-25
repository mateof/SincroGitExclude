import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  FilePen,
  GitBranch,
  GitCommitHorizontal,
  HardDrive,
  History,
  Laptop,
  RefreshCw,
  Server
} from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { relativeTime } from '@/lib/relative-time'
import { FileChanges, SyncLists, SyncTotals } from './SyncDetails'
import { SyncActivityDialog, type ActivityTarget } from './SyncActivityDialog'
import type { KbGitOverview, KbSpace, KbSyncActivity, KbSyncReport } from '../../../../shared/kb/types'

const BACKEND_ICON = { none: Laptop, git: GitBranch, folder: HardDrive, sftp: Server }
const FILES_IN_CARD = 4

function GitState({ git, onOpenCommit }: { git: KbGitOverview; onOpenCommit: (hash: string) => void }) {
  const { t, i18n } = useTranslation('kb')
  const { head } = git
  const upToDate = git.ahead === 0 && git.behind === 0 && git.pendingCount === 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {git.remote?.repoUrl ? (
          <a
            href={git.remote.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 min-w-0 text-primary hover:underline"
            title={t('sync.openRepo')}
          >
            <span className="break-all">{git.remote.label}</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          git.remote && <span className="break-all text-muted-foreground select-text">{git.remote.label}</span>
        )}
        <span className="kb-badge">
          <GitBranch className="w-3 h-3" />
          {git.branch}
        </span>
        {head && <span className="kb-badge">{t('sync.commits', { count: git.commits })}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {upToDate && head && (
          <span className="kb-badge kb-badge-success">
            <CircleCheck className="w-3 h-3" />
            {t('sync.upToDate')}
          </span>
        )}
        {git.ahead > 0 && (
          <span className="kb-badge kb-badge-warning">
            <ArrowUp className="w-3 h-3" />
            {t('sync.ahead', { count: git.ahead })}
          </span>
        )}
        {git.behind > 0 && (
          <span className="kb-badge kb-badge-warning">
            <ArrowDown className="w-3 h-3" />
            {t('sync.behind', { count: git.behind })}
          </span>
        )}
        {git.pendingCount > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer list-none">
              <span className="kb-badge kb-badge-warning">
                <FilePen className="w-3 h-3" />
                {t('sync.pending', { count: git.pendingCount })}
              </span>
            </summary>
            <div className="mt-1.5">
              <FileChanges files={git.pending} total={git.pendingCount} />
            </div>
          </details>
        )}
      </div>
      {head && (
        <div className="rounded-lg border border-border p-2.5 space-y-1.5">
          <button type="button" onClick={() => onOpenCommit(head.hash)} className="w-full text-left group">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('sync.lastCommit')}</div>
            <div className="flex items-center gap-1.5 text-xs font-medium group-hover:text-primary">
              <GitCommitHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{head.subject}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {head.author} · {relativeTime(head.date, i18n.language)} · <span className="font-mono">{head.hash.slice(0, 8)}</span>
              {!head.pushed && <span className="text-warning"> · {t('sync.notPushed')}</span>}
            </div>
          </button>
          {head.files.length > 0 && <FileChanges files={head.files.slice(0, FILES_IN_CARD)} total={head.fileCount} />}
        </div>
      )}
    </div>
  )
}

export function SyncCard({ space }: { space: KbSpace }) {
  const { t, i18n } = useTranslation('kb')
  const { syncNow, syncing } = useKbStore()
  const [last, setLast] = useState<KbSyncReport | null>(space.lastSyncStatus)
  const [git, setGit] = useState<KbGitOverview | null>(null)
  const [activity, setActivity] = useState<KbSyncActivity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<ActivityTarget | null>(null)

  useEffect(() => setLast(space.lastSyncStatus), [space.lastSyncStatus])
  useEffect(() => {
    if (space.backend === 'none' || !space.exists) return
    let current = true
    Promise.all([
      kbCall<KbGitOverview | null>('kb:git-overview', space.id),
      kbCall<KbSyncActivity>('kb:sync-activity', space.id, 20)
    ])
      .then(([overview, log]) => {
        if (!current) return
        setGit(overview)
        setActivity(log)
        setError(null)
      })
      .catch((e: Error) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [space])

  const Icon = BACKEND_ICON[space.backend]
  if (space.backend === 'none') {
    return (
      <div className="kb-card">
        <div className="kb-card-title">
          <Laptop className="w-4 h-4" />
          {t('sync.title')}
        </div>
        <p className="text-xs text-muted-foreground">{t('sync.noRemote')}</p>
      </div>
    )
  }
  const ok = last?.ok && !last.blockedBy
  const exchange = activity?.entries.find((e) => Object.values(e.totals).some((n) => n > 0))
  const showsProblem = last && !ok
  return (
    <div className="kb-card">
      <div className="kb-card-title">
        <Icon className="w-4 h-4" />
        {t('sync.title')} · {t(`space.backend.${space.backend}`)}
        <button
          type="button"
          onClick={() => void syncNow(space.id).then((r) => r && setLast(r))}
          disabled={syncing[space.id] || space.locked}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing[space.id] ? 'animate-spin' : ''}`} />
          {syncing[space.id] ? t('sync.running') : t('space.syncNow')}
        </button>
      </div>
      {!last ? (
        <p className="text-xs text-muted-foreground">{t('sync.never')}</p>
      ) : (
        <div className="space-y-1.5">
          <div className={`text-xs flex flex-wrap items-center gap-1.5 ${ok ? 'text-success' : 'text-warning'}`}>
            {ok ? <CircleCheck className="w-3.5 h-3.5" /> : <CircleAlert className="w-3.5 h-3.5" />}
            {last.blockedBy ? t(`sync.blocked.${last.blockedBy}`) : ok ? t('sync.ok') : t('sync.failed')}
            <span className="text-muted-foreground">· {t('sync.last', { date: relativeTime(last.at, i18n.language) })}</span>
          </div>
          {last.message && <p className="text-xs text-muted-foreground select-text break-words">{last.message}</p>}
          {showsProblem && <SyncLists report={last} backend={space.backend} />}
        </div>
      )}
      {git && <GitState git={git} onOpenCommit={(hash) => setTarget({ tab: 'commits', commit: hash })} />}
      {exchange && (
        <button
          type="button"
          onClick={() => setTarget({ tab: 'syncs', entry: exchange.id })}
          className="rounded-lg border border-border p-2.5 text-left hover:bg-secondary space-y-1"
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('sync.lastExchange')} · {relativeTime(exchange.at, i18n.language)}
          </div>
          <SyncTotals totals={exchange.totals} />
        </button>
      )}
      {error && <p className="text-xs text-destructive select-text">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        {activity?.nextAt
          ? t('sync.next', { date: relativeTime(activity.nextAt, i18n.language) })
          : t(space.sync.onWrite ? 'sync.nextOnWrite' : 'sync.nextManual')}
        <button
          type="button"
          onClick={() => setTarget({ tab: 'syncs' })}
          className="ml-auto inline-flex items-center gap-1.5 text-primary hover:underline"
        >
          <History className="w-3.5 h-3.5" />
          {t('sync.viewActivity')}
        </button>
      </div>
      {target && <SyncActivityDialog space={space} git={git} target={target} onClose={() => setTarget(null)} />}
    </div>
  )
}
