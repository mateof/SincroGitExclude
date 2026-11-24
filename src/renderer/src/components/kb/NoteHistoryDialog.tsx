import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, History, LoaderCircle } from 'lucide-react'
import { kbCall } from '@/stores/kb-store'
import { DiffViewer } from '@/components/diff/DiffViewer'
import type { KbHistoryEntry, KbNoteView } from '../../../../shared/kb/types'

export function NoteHistoryDialog({ note, onClose }: { note: KbNoteView; onClose: () => void }) {
  const { t, i18n } = useTranslation('kb')
  const [entries, setEntries] = useState<KbHistoryEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    kbCall<KbHistoryEntry[]>('kb:history', note.spaceId, note.path)
      .then((list) => {
        setEntries(list)
        if (list[0]) setSelected(list[0].hash)
      })
      .catch((e: Error) => setError(e.message))
  }, [note.spaceId, note.path])

  useEffect(() => {
    if (!selected) return
    setDiff('')
    kbCall<string>('kb:note-diff', note.spaceId, note.path, selected)
      .then(setDiff)
      .catch((e: Error) => setError(e.message))
  }, [selected, note.spaceId, note.path])

  const fmt = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.language === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-6xl h-[80vh] mx-4 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <History className="w-4 h-4" />
            {t('history.title', { name: note.title })}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-72 border-r border-border overflow-y-auto">
            {entries === null && !error && (
              <div className="p-4 text-muted-foreground">
                <LoaderCircle className="w-4 h-4 animate-spin" />
              </div>
            )}
            {entries?.length === 0 && <p className="p-4 text-xs text-muted-foreground">{t('history.empty')}</p>}
            {entries?.map((e) => (
              <button
                key={e.hash}
                type="button"
                onClick={() => setSelected(e.hash)}
                className={`w-full text-left px-3 py-2 border-b border-border text-xs hover:bg-secondary ${selected === e.hash ? 'bg-primary/10' : ''}`}
              >
                <div className="font-medium truncate">{e.subject}</div>
                <div className="text-muted-foreground mt-0.5">
                  {fmt(e.date)} · {e.author} · <span className="font-mono">{e.hash.slice(0, 8)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3 select-text">
            {error && <p className="text-xs text-destructive">{error}</p>}
            {!error && !selected && <p className="text-xs text-muted-foreground">{t('history.pick')}</p>}
            {diff && <DiffViewer unifiedDiff={diff} format="line-by-line" />}
          </div>
        </div>
      </div>
    </div>
  )
}
