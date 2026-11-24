import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import {
  Info,
  Lightbulb,
  TriangleAlert,
  Flame,
  CircleHelp,
  Quote,
  Bug,
  ClipboardList,
  CircleCheck,
  ListChecks,
  FileText,
  ChevronRight,
  ExternalLink,
  ImageOff
} from 'lucide-react'
import { remarkObsidian, sanitizeSchema, kbUrlTransform, textOf, decodeTarget } from '@/lib/kb-markdown'
import { headingSlug, isImagePath, parseWikiInner } from '../../../../shared/kb/wikilink'
import { kbCall, useKbStore } from '@/stores/kb-store'
import type { KbLinkView, KbNoteView } from '../../../../shared/kb/types'

interface NoteContextValue {
  spaceId: string
  path: string
  outgoing: KbLinkView[]
  depth: number
}

const NoteContext = createContext<NoteContextValue | null>(null)

const CALLOUT_ICONS: Record<string, typeof Info> = {
  note: Info,
  info: Info,
  abstract: ClipboardList,
  summary: ClipboardList,
  tldr: ClipboardList,
  todo: ListChecks,
  tip: Lightbulb,
  hint: Lightbulb,
  important: Lightbulb,
  success: CircleCheck,
  check: CircleCheck,
  done: CircleCheck,
  question: CircleHelp,
  help: CircleHelp,
  faq: CircleHelp,
  warning: TriangleAlert,
  caution: TriangleAlert,
  attention: TriangleAlert,
  failure: Flame,
  fail: Flame,
  missing: Flame,
  danger: Flame,
  error: Flame,
  bug: Bug,
  example: FileText,
  quote: Quote,
  cite: Quote
}

const CALLOUT_FAMILY: Record<string, string> = {
  info: 'note',
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote'
}

function Callout({ type, title, fold, children }: { type: string; title: string; fold: string; children: ReactNode }) {
  const [open, setOpen] = useState(fold !== '-')
  const Icon = CALLOUT_ICONS[type] ?? Info
  const family = CALLOUT_FAMILY[type] ?? type
  const label = title || type.charAt(0).toUpperCase() + type.slice(1)
  return (
    <div className={`kb-callout kb-callout-${family}`}>
      <button
        type="button"
        className="kb-callout-title"
        onClick={() => fold && setOpen(!open)}
        aria-expanded={open}
        disabled={!fold}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span>{label}</span>
        {fold && <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && <div className="kb-callout-body">{children}</div>}
    </div>
  )
}

function findLink(ctx: NoteContextValue, target: string, embed: boolean): KbLinkView | undefined {
  return ctx.outgoing.find((l) => l.target === target && l.embed === embed) ?? ctx.outgoing.find((l) => l.target === target)
}

function WikiLink({ inner, children }: { inner: string; children: ReactNode }) {
  const { t } = useTranslation('kb')
  const ctx = useContext(NoteContext)!
  const openNote = useKbStore((s) => s.openNote)
  const { target, heading } = parseWikiInner(inner)
  const link = target ? findLink(ctx, target, false) : null
  const resolved = target ? link?.resolved : { spaceId: ctx.spaceId, path: ctx.path, title: '' }
  if (!resolved) {
    return (
      <span className="kb-link kb-link-broken" title={t('note.broken')}>
        {children}
      </span>
    )
  }
  return (
    <a
      href="#"
      className={`kb-link ${link?.crossesToPrivate ? 'kb-link-private' : ''}`}
      title={link?.crossesToPrivate ? t('note.privateLink') : resolved.title || resolved.path}
      onClick={(e) => {
        e.preventDefault()
        if (!target && heading) {
          document.getElementById(`h-${headingSlug(heading)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        void openNote(resolved.spaceId, resolved.path, heading)
      }}
    >
      {children}
    </a>
  )
}

function TagPill({ tag }: { tag: string }) {
  const setQuickOpen = useKbStore((s) => s.setQuickOpen)
  return (
    <button
      type="button"
      className="kb-tag"
      onClick={() => {
        sessionStorage.setItem('kbQuickQuery', `#${tag}`)
        setQuickOpen(true)
      }}
    >
      {`#${tag}`}
    </button>
  )
}

function KbImage({ target, alt, fromPath }: { target: string; alt: string; fromPath?: string }) {
  const { t } = useTranslation('kb')
  const ctx = useContext(NoteContext)!
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)
    kbCall<{ dataUrl: string }>('kb:read-asset', ctx.spaceId, fromPath ?? ctx.path, target)
      .then((r) => !cancelled && setSrc(r.dataUrl))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [ctx.spaceId, ctx.path, target, fromPath])
  if (failed) {
    return (
      <span className="kb-embed-missing">
        <ImageOff className="w-4 h-4" />
        {t('note.embedMissing', { target })}
      </span>
    )
  }
  if (!src) return <span className="kb-image-placeholder" />
  return <img src={src} alt={alt} className="kb-image" loading="lazy" />
}

function sectionOf(markdown: string, heading: string | null): string {
  if (!heading) return markdown
  const lines = markdown.split(/\r?\n/)
  const wanted = headingSlug(heading)
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (!m) continue
    if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join('\n')
    if (start < 0 && headingSlug(m[2]) === wanted) {
      start = i
      level = m[1].length
    }
  }
  return start >= 0 ? lines.slice(start).join('\n') : markdown
}

function NoteEmbed({ link, heading }: { link: KbLinkView; heading: string | null }) {
  const { t } = useTranslation('kb')
  const ctx = useContext(NoteContext)!
  const openNote = useKbStore((s) => s.openNote)
  const [view, setView] = useState<KbNoteView | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!link.resolved) return
    let cancelled = false
    kbCall<KbNoteView>('kb:note-view', link.resolved.spaceId, link.resolved.path)
      .then((v) => !cancelled && setView(v))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [link.resolved?.spaceId, link.resolved?.path])
  if (ctx.depth >= 2) return <div className="kb-embed-missing">{t('note.embedLoop')}</div>
  if (error || !link.resolved) return <div className="kb-embed-missing">{t('note.embedMissing', { target: link.target })}</div>
  if (!view) return <div className="kb-embed kb-embed-loading" />
  return (
    <div className="kb-embed">
      <button type="button" className="kb-embed-title" onClick={() => void openNote(view.spaceId, view.path, heading)}>
        <FileText className="w-3.5 h-3.5" />
        {view.title}
        {heading ? ` › ${heading}` : ''}
      </button>
      <MarkdownView
        markdown={sectionOf(view.body, heading)}
        spaceId={view.spaceId}
        path={view.path}
        outgoing={view.outgoing}
        depth={ctx.depth + 1}
      />
    </div>
  )
}

function Embed({ inner, alt }: { inner: string; alt: string }) {
  const { t } = useTranslation('kb')
  const ctx = useContext(NoteContext)!
  const { target, heading } = parseWikiInner(inner)
  if (isImagePath(target)) return <KbImage target={target} alt={alt} />
  const link = findLink(ctx, target, true)
  if (!link) return <span className="kb-embed-missing">{t('note.embedMissing', { target })}</span>
  if (link.resolved && !link.resolved.path.endsWith('.md')) {
    return <span className="kb-embed-missing">{link.resolved.path}</span>
  }
  return <NoteEmbed link={link} heading={heading} />
}

let mermaidModule: Promise<typeof import('mermaid')> | null = null

function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    mermaidModule = mermaidModule ?? import('mermaid')
    mermaidModule
      .then(async (mod) => {
        const mermaid = mod.default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.classList.contains('light') ? 'default' : 'dark'
        })
        const result = await mermaid.render(`mmd${id}`, code)
        if (!cancelled) setSvg(result.svg)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [code, id])
  if (error) return <pre className="kb-mermaid-error">{code}</pre>
  if (!svg) return <div className="kb-mermaid kb-mermaid-loading" />
  return <div className="kb-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const
  return function Heading({ children }: { children?: ReactNode }) {
    const id = `h-${headingSlug(textOf(children))}`
    return (
      <Tag id={id} className="kb-heading">
        {children}
      </Tag>
    )
  }
}

const components: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  a: ({ href, children }) => {
    const url = href ?? ''
    if (url.startsWith('kb-wiki:')) return <WikiLink inner={decodeTarget(url, 'kb-wiki:')}>{children}</WikiLink>
    if (url.startsWith('kb-tag:')) return <TagPill tag={decodeTarget(url, 'kb-tag:')} />
    if (/^(https?|mailto):/i.test(url)) {
      return (
        <a href={url} target="_blank" rel="noreferrer noopener" className="kb-external">
          {children}
          <ExternalLink className="kb-external-icon" />
        </a>
      )
    }
    if (url.startsWith('#')) {
      return (
        <a href={url} onClick={(e) => {
          e.preventDefault()
          document.getElementById(`h-${headingSlug(decodeURIComponent(url.slice(1)))}`)?.scrollIntoView({ behavior: 'smooth' })
        }}>
          {children}
        </a>
      )
    }
    let target = url
    try {
      target = decodeURIComponent(url)
    } catch {
      target = url
    }
    return <WikiLink inner={target}>{children}</WikiLink>
  },
  img: ({ src, alt }) => {
    const url = typeof src === 'string' ? src : ''
    if (url.startsWith('kb-embed:')) return <Embed inner={decodeTarget(url, 'kb-embed:')} alt={alt ?? ''} />
    if (/^https?:/i.test(url)) {
      return (
        <a href={url} target="_blank" rel="noreferrer noopener" className="kb-external">
          <ImageOff className="w-4 h-4 inline mr-1" />
          {alt || url}
        </a>
      )
    }
    let target = url
    try {
      target = decodeURIComponent(url)
    } catch {
      target = url
    }
    return <KbImage target={target} alt={alt ?? ''} />
  },
  blockquote: (props) => {
    const p = props as unknown as { children?: ReactNode; 'data-callout'?: string; 'data-callout-title'?: string; 'data-callout-fold'?: string; node?: { properties?: Record<string, unknown> } }
    const properties = p.node?.properties ?? {}
    const type = (properties.dataCallout as string | undefined) ?? p['data-callout']
    if (type) {
      return (
        <Callout
          type={type}
          title={((properties.dataCalloutTitle as string | undefined) ?? p['data-callout-title']) || ''}
          fold={((properties.dataCalloutFold as string | undefined) ?? p['data-callout-fold']) || ''}
        >
          {p.children}
        </Callout>
      )
    }
    return <blockquote>{p.children}</blockquote>
  },
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children
    const className = (child as { props?: { className?: string } })?.props?.className ?? ''
    if (className.includes('language-mermaid')) return <Mermaid code={textOf((child as { props: { children?: unknown } }).props.children).trim()} />
    return <pre>{children}</pre>
  },
  table: ({ children }) => (
    <div className="kb-table-wrap">
      <table>{children}</table>
    </div>
  ),
  input: (props) => <input {...props} disabled />
}

export function MarkdownView({
  markdown,
  spaceId,
  path,
  outgoing,
  depth = 0
}: {
  markdown: string
  spaceId: string
  path: string
  outgoing: KbLinkView[]
  depth?: number
}) {
  const value = useMemo(() => ({ spaceId, path, outgoing, depth }), [spaceId, path, outgoing, depth])
  return (
    <NoteContext.Provider value={value}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkObsidian]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema], [rehypeHighlight, { detect: false, plainText: ['mermaid', 'txt', 'text', 'dataview'] }]]}
        urlTransform={kbUrlTransform}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </NoteContext.Provider>
  )
}
