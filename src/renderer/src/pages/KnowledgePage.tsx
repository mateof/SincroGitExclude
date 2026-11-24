import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  FolderOpen,
  RefreshCw,
  Settings2,
  TriangleAlert,
  FileText,
  Bot,
  GitBranch,
  HardDrive,
  Server,
  Laptop,
  Users,
  ShieldCheck,
  Library,
  Plus,
  CircleCheck,
  CircleAlert,
  Hash
} from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import { NoteView } from '@/components/kb/NoteView'
import { SpaceDialog } from '@/components/kb/SpaceDialog'
import { ReviewDialog } from '@/components/kb/ReviewDialog'
import { EncryptionCard } from '@/components/kb/EncryptionCard'
import type { KbSpace, KbSyncReport } from '../../../shared/kb/types'

const BACKEND_ICON = { none: Laptop, git: GitBranch, folder: HardDrive, sftp: Server }

function relative(iso: string | null, lang: string): string {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat(lang === 'es' ? 'es' : 'en', { numeric: 'auto' })
  if (diff < 60) return rtf.format(-Math.round(diff), 'second')
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  return rtf.format(-Math.round(diff / 86400), 'day')
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {title} ({items.length})
      </summary>
      <ul className="mt-1 ml-4 list-disc space-y-0.5 font-mono text-[11px] select-text">
        {items.slice(0, 50).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  )
}

function SyncCard({ space }: { space: KbSpace }) {
  const { t, i18n } = useTranslation('kb')
  const { syncNow, syncing } = useKbStore()
  const [last, setLast] = useState<KbSyncReport | null>(space.lastSyncStatus)
  useEffect(() => setLast(space.lastSyncStatus), [space.lastSyncStatus])
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
          <div className={`text-xs flex items-center gap-1.5 ${ok ? 'text-success' : 'text-warning'}`}>
            {ok ? <CircleCheck className="w-3.5 h-3.5" /> : <CircleAlert className="w-3.5 h-3.5" />}
            {last.blockedBy ? t(`sync.blocked.${last.blockedBy}`) : ok ? t('sync.ok') : t('sync.failed')}
            <span className="text-muted-foreground">· {t('sync.last', { date: relative(last.at, i18n.language) })}</span>
          </div>
          {last.message && <p className="text-xs text-muted-foreground select-text">{last.message}</p>}
          <ReportList title={t('sync.pulled')} items={last.pulled} />
          <ReportList title={t('sync.pushed')} items={last.pushed} />
          <ReportList title={t('sync.conflicts')} items={last.conflicts} />
          <ReportList title={t('sync.deletedLocal')} items={last.deletedLocal} />
          <ReportList title={t('sync.deletedRemote')} items={last.deletedRemote} />
          <ReportList title={t('sync.secrets')} items={last.secrets.map((s) => `${s.path}:${s.line} (${s.rule})`)} />
        </div>
      )}
    </div>
  )
}

function SpaceOverview({ space }: { space: KbSpace }) {
  const { t, i18n } = useTranslation('kb')
  const { openNote, trees, spaces } = useKbStore()
  const isWebMode = useUIStore((s) => s.isWebMode)
  const [recent, setRecent] = useState<Array<{ spaceId: string; path: string; title: string; mtime: string }>>([])
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([])
  const [editing, setEditing] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    if (space.locked || !space.exists) return
    kbCall<typeof recent>('kb:recent', { spaceIds: [space.id], limit: 12 }).then(setRecent).catch(() => setRecent([]))
    kbCall<typeof tags>('kb:tags', [space.id]).then(setTags).catch(() => setTags([]))
  }, [space.id, space.stats?.notes, space.locked, space.exists])

  const inbox = trees[space.id]?.children?.find((c) => c.type === 'folder' && c.name.toLowerCase() === 'inbox')
  const parent = spaces.find((s) => s.id === space.parentId)
  const action = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary'

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{space.name}</h1>
            {space.shared && <span className="kb-badge"><Users className="w-3 h-3" />{t('space.shared')}</span>}
            {space.encrypted && <span className="kb-badge kb-badge-success"><ShieldCheck className="w-3 h-3" />{t('space.encrypted')}</span>}
            {parent && <span className="kb-badge">{t('space.nested', { name: parent.name })}</span>}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1 break-all select-text">{space.localPath}</div>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
          {!isWebMode && (
            <>
              <button type="button" className={action} onClick={() => void kbCall('kb:open-in-obsidian', space.id)}>
                <BookOpen className="w-3.5 h-3.5" />
                {t('space.openInObsidian')}
              </button>
              <button type="button" className={action} onClick={() => void kbCall('kb:show-in-folder', space.id)}>
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button type="button" className={action} onClick={() => setEditing(true)}>
            <Settings2 className="w-3.5 h-3.5" />
            {t('space.settings')}
          </button>
        </div>
      </div>

      {!space.exists && (
        <div className="kb-alert kb-alert-danger">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <div>{t('space.missingTitle')}</div>
        </div>
      )}
      {space.cloudSynced && (
        <div className="kb-alert kb-alert-warning">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <div className="font-semibold">{t('space.cloudWarningTitle')}</div>
            <p>{t('space.cloudWarningBody')}</p>
            {!isWebMode && (
              <button type="button" className="px-3 py-1 text-xs border border-warning/50 rounded-md" onClick={() => setEditing(true)}>
                {t('space.relocate')}
              </button>
            )}
          </div>
        </div>
      )}
      {space.pendingReview > 0 && (
        <div className="kb-alert kb-alert-info">
          <Bot className="w-4 h-4 shrink-0" />
          <div className="flex-1">{t('review.pending', { count: space.pendingReview })}</div>
          {!isWebMode && (
            <button type="button" className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md" onClick={() => setReviewing(true)}>
              {t('review.open')}
            </button>
          )}
        </div>
      )}

      {space.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['notes', 'files', 'tags', 'unresolved'] as const).map((k) => (
            <div key={k} className="kb-stat">
              <div className="kb-stat-value">{space.stats![k]}</div>
              <div className="kb-stat-label">{t(`space.stats.${k}`)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="kb-card">
          <div className="kb-card-title">
            <FileText className="w-4 h-4" />
            {t('space.recent')}
            {inbox?.noteCount ? <span className="ml-auto kb-badge kb-badge-warning">{t('space.inboxCount', { count: inbox.noteCount })}</span> : null}
          </div>
          {recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('space.noRecent')}</p>
          ) : (
            <div className="-mx-2">
              {recent.map((n) => (
                <button
                  key={n.path}
                  type="button"
                  onClick={() => void openNote(n.spaceId, n.path)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary text-left"
                >
                  <span className="text-xs truncate flex-1">{n.title}</span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">{n.path.split('/').slice(0, -1).join('/')}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{relative(n.mtime, i18n.language)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <SyncCard space={space} />
          <EncryptionCard space={space} />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="kb-card">
          <div className="kb-card-title">
            <Hash className="w-4 h-4" />
            {t('space.tags')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 60).map((tag) => (
              <button
                key={tag.tag}
                type="button"
                className="kb-tag"
                onClick={() => {
                  sessionStorage.setItem('kbQuickQuery', `#${tag.tag}`)
                  useKbStore.getState().setQuickOpen(true)
                }}
              >
                {`#${tag.tag}`} <span className="opacity-60">{tag.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {editing && <SpaceDialog space={space} onClose={() => setEditing(false)} />}
      {reviewing && <ReviewDialog spaceId={space.id} onClose={() => setReviewing(false)} />}
    </div>
  )
}

export function KnowledgePage() {
  const { t } = useTranslation('kb')
  const { spaces, loaded, selectedSpaceId, selectedPath, loadSpaces } = useKbStore()
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!loaded) void loadSpaces()
  }, [loaded, loadSpaces])

  if (selectedPath) return <NoteView />
  const space = spaces.find((s) => s.id === selectedSpaceId)
  if (loaded && !space) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <Library className="w-10 h-10 mx-auto text-primary" />
          <h1 className="text-lg font-semibold">{t('empty.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('empty.body')}</p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg"
          >
            <Plus className="w-4 h-4" />
            {t('empty.add')}
          </button>
        </div>
        {adding && <SpaceDialog onClose={() => setAdding(false)} />}
      </div>
    )
  }
  if (!space) return null
  return <SpaceOverview space={space} />
}
