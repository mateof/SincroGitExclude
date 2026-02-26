import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import hljs from 'highlight.js/lib/common'
import { Marked } from 'marked'
import { ChevronDown, ChevronRight, FileCode, BookOpen, X } from 'lucide-react'

export interface FileContentEntry {
  path: string
  content: string
}

interface FileContentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: FileContentEntry[]
  title?: string
}

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  ini: 'ini',
  toml: 'ini',
  env: 'bash'
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])

function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return ext ? MARKDOWN_EXTENSIONS.has(ext) : false
}

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      let highlighted: string
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(text, { language: lang }).value
        } else {
          highlighted = hljs.highlightAuto(text).value
        }
      } catch {
        highlighted = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      }
      return `<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`
    }
  }
})

function getLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return ext ? LANG_MAP[ext] : undefined
}

function highlightCode(content: string, filePath: string): string {
  const lang = getLanguage(filePath)
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(content, { language: lang }).value
    }
    return hljs.highlightAuto(content).value
  } catch {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

function renderMarkdown(content: string): string {
  try {
    return marked.parse(content) as string
  } catch {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

export function FileContentModal({
  open,
  onOpenChange,
  files,
  title
}: FileContentModalProps) {
  const { t } = useTranslation('commits')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [markdownView, setMarkdownView] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  // Auto-enable markdown view for markdown files when files change
  useEffect(() => {
    const mdIndices = new Set<number>()
    files.forEach((f, i) => {
      if (isMarkdownFile(f.path)) mdIndices.add(i)
    })
    setMarkdownView(mdIndices)
  }, [files])

  const highlighted = useMemo(() => {
    return files.map((f) => ({
      ...f,
      html: highlightCode(f.content, f.path),
      markdownHtml: isMarkdownFile(f.path) ? renderMarkdown(f.content) : '',
      isMarkdown: isMarkdownFile(f.path),
      lineCount: f.content.split('\n').length
    }))
  }, [files])

  const toggleCollapse = (index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const toggleMarkdownView = (index: number) => {
    setMarkdownView((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-6xl max-h-[90vh] mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {title && <span className="text-sm font-medium truncate">{title}</span>}
            <span className="text-xs text-muted-foreground">
              {t('diff.filesChanged', { count: files.length })}
            </span>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded text-muted-foreground hover:bg-secondary transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 flex-1 space-y-3">
          {highlighted.map((entry, index) => (
            <div key={index} className="border border-border rounded-lg overflow-hidden">
              {/* File header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-card">
                <button
                  onClick={() => toggleCollapse(index)}
                  className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
                >
                  {collapsed.has(index) ? (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <FileCode className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono truncate">{entry.path}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                    {t('diff.lines', { count: entry.lineCount })}
                  </span>
                </button>

                {/* Markdown toggle */}
                {entry.isMarkdown && !collapsed.has(index) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleMarkdownView(index)
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 ${
                      markdownView.has(index)
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary'
                    }`}
                    title={markdownView.has(index) ? t('diff.viewCode') : t('diff.viewMarkdown')}
                  >
                    {markdownView.has(index) ? (
                      <>
                        <BookOpen className="w-3 h-3" />
                        Markdown
                      </>
                    ) : (
                      <>
                        <FileCode className="w-3 h-3" />
                        {t('diff.viewCode')}
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Content */}
              {!collapsed.has(index) && (
                <>
                  {/* Markdown rendered view */}
                  {entry.isMarkdown && markdownView.has(index) ? (
                    <div className="overflow-auto border-t border-border bg-background">
                      {entry.content ? (
                        <div
                          className="markdown-body p-6"
                          dangerouslySetInnerHTML={{ __html: entry.markdownHtml }}
                        />
                      ) : (
                        <div className="p-4 text-xs text-muted-foreground text-center">
                          {t('diff.emptyFile')}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Code view */
                    <div className="overflow-auto border-t border-border" style={{ background: 'var(--code-bg)' }}>
                      {entry.content ? (
                        <table className="code-viewer-table">
                          <tbody>
                            {entry.html.split('\n').map((line, lineIdx) => (
                              <tr key={lineIdx} className="code-viewer-row">
                                <td className="code-viewer-gutter">{lineIdx + 1}</td>
                                <td
                                  className="code-viewer-code"
                                  dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }}
                                />
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="p-4 text-xs text-muted-foreground text-center">
                          {t('diff.emptyFile')}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
