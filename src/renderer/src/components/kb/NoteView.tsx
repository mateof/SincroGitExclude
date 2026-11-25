import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  FolderOpen,
  Link2,
  Copy,
  History,
  Type,
  ChevronRight,
  FileText,
  TriangleAlert,
  LoaderCircle,
  Hash,
  ArrowLeft
} from 'lucide-react'
import { useKbStore, kbCall } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import { copyText } from '@/lib/clipboard'
import { headingSlug, basenameNoExt } from '../../../../shared/kb/wikilink'
import { MarkdownView } from './MarkdownView'
import { NoteHistoryDialog } from './NoteHistoryDialog'
import type { KbNoteView } from '../../../../shared/kb/types'

type Font = 'sans' | 'serif'
type Size = 'sm' | 'md' | 'lg'
type Width = 'narrow' | 'normal' | 'wide'

function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || fallback
    } catch {
      return fallback
    }
  })
  return [
    value,
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, v)
      } catch {
        return
      }
    }
  ]
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(formatValue).join(', ')
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function Properties({ note }: { note: KbNoteView }) {
  const entries = Object.entries(note.frontmatter).filter(([k]) => k !== 'tags' && k !== 'tag' && k !== 'title')
  if (entries.length === 0 && note.tags.length === 0) return null
  return (
    <div className="kb-properties">
      {note.tags.length > 0 && (
        <div className="kb-property">
          <Hash className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="kb-tag"
                onClick={() => {
                  sessionStorage.setItem('kbQuickQuery', `#${tag}`)
                  useKbStore.getState().setQuickOpen(true)
                }}
              >
                {`#${tag}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {entries.map(([key, value]) => (
        <div key={key} className="kb-property">
          <span className="kb-property-key">{key}</span>
          <span className="kb-property-value">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

function Outline({ note, scrollRoot }: { note: KbNoteView; scrollRoot: HTMLElement | null }) {
  const { t } = useTranslation('kb')
  const [active, setActive] = useState<string | null>(null)
  const headings = note.headings.filter((h, i) => h.level <= 4 && !(i === 0 && h.level === 1 && h.text === note.title))
  const minLevel = Math.min(...headings.map((h) => h.level), 6)
  useEffect(() => {
    if (!scrollRoot) return
    const ids = headings.map((h) => `h-${headingSlug(h.text)}`)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { root: scrollRoot, rootMargin: '0px 0px -70% 0px' }
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [note.hash, scrollRoot])
  if (headings.length < 2) return null
  return (
    <div className="kb-side-section">
      <div className="kb-side-title">{t('note.outline')}</div>
      <nav className="space-y-0.5">
        {headings.map((h, i) => {
          const id = `h-${headingSlug(h.text)}`
          return (
            <button
              key={`${id}-${i}`}
              type="button"
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`kb-outline-item ${active === id ? 'kb-outline-active' : ''}`}
              style={{ paddingLeft: `${(h.level - minLevel) * 12 + 8}px` }}
            >
              {h.text}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function LinksPanel({ note }: { note: KbNoteView }) {
  const { t } = useTranslation('kb')
  const openNote = useKbStore((s) => s.openNote)
  const links = useMemo(() => {
    const seen = new Set<string>()
    return note.outgoing.filter((l) => {
      if (l.embed || !l.target) return false
      const key = l.resolved ? `${l.resolved.spaceId}:${l.resolved.path}` : `x:${l.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [note.outgoing])
  return (
    <>
      <div className="kb-side-section">
        <div className="kb-side-title">
          {t('note.backlinks')} <span className="kb-count">{note.backlinks.length}</span>
        </div>
        {note.backlinks.length === 0 ? (
          <p className="kb-side-empty">{t('note.noBacklinks')}</p>
        ) : (
          note.backlinks.map((b) => (
            <button key={`${b.spaceId}:${b.path}`} type="button" className="kb-side-link" onClick={() => void openNote(b.spaceId, b.path)}>
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{b.title}</span>
            </button>
          ))
        )}
      </div>
      <div className="kb-side-section">
        <div className="kb-side-title">
          {t('note.links')} <span className="kb-count">{links.length}</span>
        </div>
        {links.length === 0 ? (
          <p className="kb-side-empty">{t('note.noLinks')}</p>
        ) : (
          links.map((l) =>
            l.resolved ? (
              <button
                key={`${l.resolved.spaceId}:${l.resolved.path}`}
                type="button"
                className={`kb-side-link ${l.crossesToPrivate ? 'text-warning' : ''}`}
                title={l.crossesToPrivate ? t('note.privateLink') : l.resolved.path}
                onClick={() => void openNote(l.resolved!.spaceId, l.resolved!.path, l.heading)}
              >
                {l.crossesToPrivate ? <TriangleAlert className="w-3.5 h-3.5 shrink-0" /> : <Link2 className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{l.resolved.title}</span>
              </button>
            ) : (
              <div key={`x:${l.target}`} className="kb-side-link kb-side-broken" title={t('note.broken')}>
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{l.target}</span>
              </div>
            )
          )
        )}
      </div>
    </>
  )
}

export function NoteView() {
  const { t, i18n } = useTranslation('kb')
  const { note, noteError, loadingNote, pendingHeading, closeNote, spaces } = useKbStore()
  const isWebMode = useUIStore((s) => s.isWebMode)
  const [font, setFont] = usePref<Font>('kbFont', 'sans')
  const [size, setSize] = usePref<Size>('kbSize', 'md')
  const [width, setWidth] = usePref<Width>('kbWidth', 'normal')
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!note) return
    if (pendingHeading) {
      requestAnimationFrame(() =>
        document.getElementById(`h-${headingSlug(pendingHeading)}`)?.scrollIntoView({ block: 'start' })
      )
    } else {
      scrollRef.current?.scrollTo({ top: 0 })
    }
  }, [note?.spaceId, note?.path])

  if (loadingNote && !note) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <LoaderCircle className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (noteError || !note) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">{t('note.notFound')}</p>
        <p>{noteError}</p>
      </div>
    )
  }

  const space = spaces.find((s) => s.id === note.spaceId)
  const crumbs = note.path.split('/').slice(0, -1)
  const flash = (key: string): void => {
    setCopied(key)
    setTimeout(() => setCopied(null), 1200)
  }
  const action = 'inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors'
  const modified = new Date(note.mtimeMs).toLocaleString(i18n.language === 'es' ? 'es-ES' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })

  return (
    <>
      <div className="flex h-full @container">
        <div
          className="flex-1 overflow-y-auto select-text"
          ref={(el) => {
            scrollRef.current = el
            if (el !== scrollRoot) setScrollRoot(el)
          }}
        >
          <div className="sticky top-0 z-10 bg-background/85 backdrop-blur border-b border-border">
            <div className="flex items-center gap-1 px-4 py-2">
              <button type="button" className={action} onClick={closeNote}>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 flex-1">
                <span className="truncate">{space?.name}</span>
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    <ChevronRight className="w-3 h-3 shrink-0" />
                    <span className="truncate">{c}</span>
                  </span>
                ))}
              </div>
              {!isWebMode && (
                <>
                  <button
                    type="button"
                    className={action}
                    onClick={() => void kbCall('kb:open-in-obsidian', note.spaceId, note.path)}
                    title={t('note.openInObsidian')}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span className="hidden @3xl:inline">{t('note.openInObsidian')}</span>
                  </button>
                  <button
                    type="button"
                    className={action}
                    onClick={() => void kbCall('kb:show-in-folder', note.spaceId, note.path)}
                    title={t('note.showInFolder')}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                className={action}
                title={t('note.copyWikilink')}
                onClick={async () => {
                  if (await copyText(`[[${basenameNoExt(note.path)}]]`)) flash('wiki')
                }}
              >
                <Link2 className="w-3.5 h-3.5" />
                {copied === 'wiki' && <span>{t('note.copied')}</span>}
              </button>
              <button
                type="button"
                className={action}
                title={t('note.copyPath')}
                onClick={async () => {
                  if (await copyText(note.absolutePath)) flash('path')
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                {copied === 'path' && <span>{t('note.copied')}</span>}
              </button>
              <button type="button" className={action} title={t('note.history')} onClick={() => setHistoryOpen(true)}>
                <History className="w-3.5 h-3.5" />
              </button>
              <div className="relative">
                <button type="button" className={action} title={t('note.reading')} onClick={() => setPrefsOpen(!prefsOpen)}>
                  <Type className="w-3.5 h-3.5" />
                </button>
                {prefsOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-xl p-3 space-y-3 text-xs z-20">
                    {(
                      [
                        ['font', font, setFont, ['sans', 'serif']],
                        ['size', size, setSize, ['sm', 'md', 'lg']],
                        ['width', width, setWidth, ['narrow', 'normal', 'wide']]
                      ] as const
                    ).map(([label, value, setter, options]) => (
                      <div key={label}>
                        <div className="text-muted-foreground mb-1">{t(`note.${label}`)}</div>
                        <div className="flex gap-1">
                          {options.map((o) => (
                            <button
                              key={o}
                              type="button"
                              onClick={() => (setter as (v: string) => void)(o)}
                              className={`flex-1 px-2 py-1 rounded-md border ${value === o ? 'border-primary text-primary bg-primary/10' : 'border-border hover:bg-secondary'}`}
                            >
                              {o === 'sm' ? 'A-' : o === 'md' ? 'A' : o === 'lg' ? 'A+' : t(`note.${o}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <article className={`kb-prose kb-font-${font} kb-size-${size} kb-width-${width}`}>
            <h1 className="kb-title">{note.title}</h1>
            <div className="kb-meta">{t('note.modified', { date: modified })}</div>
            {note.frontmatterError && (
              <div className="kb-callout kb-callout-warning">
                <div className="kb-callout-body">{t('note.frontmatterError', { error: note.frontmatterError })}</div>
              </div>
            )}
            <Properties note={note} />
            <MarkdownView
              markdown={note.body.replace(new RegExp(`^\\s*#\\s+${note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`), '')}
              spaceId={note.spaceId}
              path={note.path}
              outgoing={note.outgoing}
            />
          </article>
        </div>
        <aside className="hidden @5xl:block w-64 shrink-0 border-l border-border overflow-y-auto p-3 space-y-4 bg-card/30">
          <Outline note={note} scrollRoot={scrollRoot} />
          <LinksPanel note={note} />
        </aside>
      </div>
      {historyOpen && <NoteHistoryDialog note={note} onClose={() => setHistoryOpen(false)} />}
    </>
  )
}
