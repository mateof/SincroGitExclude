import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import type { ManagedFile } from '@/types'
import { TagSelector } from './TagSelector'
import { X } from 'lucide-react'

interface FileEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: ManagedFile
}

export function FileEditDialog({ open, onOpenChange, file }: FileEditDialogProps) {
  const { t } = useTranslation('files')
  const { t: tc } = useTranslation('common')
  const { updateFile, setFileTags } = useFileStore()
  const [name, setName] = useState(file.name)
  const [alias, setAlias] = useState(file.alias)
  const [useAutoIcon, setUseAutoIcon] = useState(file.useAutoIcon)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(file.tags.map((t) => t.id))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setName(file.name)
    setAlias(file.alias)
    setUseAutoIcon(file.useAutoIcon)
    setSelectedTagIds(file.tags.map((t) => t.id))
  }, [file])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !alias.trim()) return
    setLoading(true)
    await updateFile(file.id, { name: name.trim(), alias: alias.trim(), useAutoIcon })
    await setFileTags(file.id, selectedTagIds)
    setLoading(false)
    onOpenChange(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('editTitle')}</h2>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('fields.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('fields.alias')}</label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          {file.type === 'file' && (
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">
                  {t('fields.autoIcon')}
                </label>
                <p className="text-[10px] text-muted-foreground/70">
                  {t('fields.autoIconHint')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUseAutoIcon(!useAutoIcon)}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                  useAutoIcon ? 'bg-primary' : 'bg-secondary border border-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    useAutoIcon ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}
          <TagSelector selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors"
            >
              {tc('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !alias.trim() || loading}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : tc('actions.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
