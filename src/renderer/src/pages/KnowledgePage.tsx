import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  ExternalLink,
  FolderOpen,
  Settings2,
  TriangleAlert,
  FileText,
  Bot,
  Users,
  ShieldCheck,
  Library,
  Plus,
  Hash
} from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import { NoteView } from '@/components/kb/NoteView'
import { SpaceDialog } from '@/components/kb/SpaceDialog'
import { ReviewDialog } from '@/components/kb/ReviewDialog'
import { EncryptionCard } from '@/components/kb/EncryptionCard'
import { SyncCard } from '@/components/kb/SyncCard'
import { relativeTime } from '@/lib/relative-time'
import { safeRemoteLinks } from '../../../shared/kb/git-remote'
import type { KbSpace } from '../../../shared/kb/types'

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
  const repo = space.backend === 'git' ? safeRemoteLinks(space.backendConfig.remoteUrl) : null
  const action = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary'

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{space.name}</h1>
            {space.shared && <span className="kb-badge"><Users className="w-3 h-3" />{t('space.shared')}</span>}
            {space.encrypted && <span className="kb-badge kb-badge-success"><ShieldCheck className="w-3 h-3" />{t('space.encrypted')}</span>}
            {parent && <span className="kb-badge">{t('space.nested', { name: parent.name })}</span>}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1 break-all select-text">{space.localPath}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
          {repo?.repoUrl && (
            <a href={repo.repoUrl} target="_blank" rel="noreferrer noopener" className={action} title={repo.repoUrl}>
              <ExternalLink className="w-3.5 h-3.5" />
              {t(`space.openRepo.${repo.provider}`)}
            </a>
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
        <div className="@container">
          <div className="grid grid-cols-2 @lg:grid-cols-4 gap-3">
            {(['notes', 'files', 'tags', 'unresolved'] as const).map((k) => (
              <div key={k} className="kb-stat">
                <div className="kb-stat-value">{space.stats![k]}</div>
                <div className="kb-stat-label">{t(`space.stats.${k}`)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4">
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
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{relativeTime(n.mtime, i18n.language)}</span>
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
