import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createTwoFilesPatch } from 'diff'
import { X, Check, Undo2, Bot } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { DiffViewer } from '@/components/diff/DiffViewer'
import type { KbAuditEntry } from '../../../../shared/kb/types'

export function ReviewDialog({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('kb')
  const loadSpaces = useKbStore((s) => s.loadSpaces)
  const [items, setItems] = useState<KbAuditEntry[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [diff, setDiff] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const list = await kbCall<KbAuditEntry[]>('kb:review-list', spaceId)
    setItems(list)
    setSelected((current) => (current && list.some((i) => i.id === current) ? current : (list[0]?.id ?? null)))
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message))
  }, [spaceId])

  useEffect(() => {
    if (selected === null) {
      setDiff('')
      return
    }
    kbCall<{ path: string; before: string; after: string }>('kb:review-diff', spaceId, selected)
      .then((d) => setDiff(createTwoFilesPatch(`a/${d.path}`, `b/${d.path}`, d.before, d.after)))
      .catch((e: Error) => setError(e.message))
  }, [selected, spaceId])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      await load()
      await loadSpaces()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-6xl h-[80vh] mx-4 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4" />
            {t('review.title')}
          </h2>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => void run(() => kbCall('kb:review-approve', spaceId, 'all'))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg"
              >
                <Check className="w-3.5 h-3.5" />
                {t('review.approveAll')}
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-80 border-r border-border overflow-y-auto">
            {items.length === 0 && <p className="p-4 text-xs text-muted-foreground">{t('review.empty')}</p>}
            {items.map((item) => (
              <div
                key={item.id}
                className={`px-3 py-2 border-b border-border text-xs cursor-pointer ${selected === item.id ? 'bg-primary/10' : 'hover:bg-secondary'}`}
                onClick={() => setSelected(item.id)}
              >
                <div className="font-medium truncate">{item.path}</div>
                <div className="text-muted-foreground mt-0.5">
                  {t('review.by', { tool: item.tool ?? '', token: item.tokenName ?? item.source })} ·{' '}
                  {new Date(`${item.at}Z`).toLocaleString(i18n.language === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void run(() => kbCall('kb:review-approve', spaceId, [item.id]))
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded-md hover:bg-secondary"
                  >
                    <Check className="w-3 h-3" />
                    {t('review.approve')}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void run(() => kbCall('kb:review-revert', spaceId, item.id))
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded-md hover:bg-destructive/10 text-destructive"
                  >
                    <Undo2 className="w-3 h-3" />
                    {t('review.revert')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3 select-text">
            {error && <p className="text-xs text-destructive mb-2">{error}</p>}
            {diff && <DiffViewer unifiedDiff={diff} format="side-by-side" />}
          </div>
        </div>
      </div>
    </div>
  )
}
