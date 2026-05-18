import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRepoStore } from '@/stores/repo-store'
import { TagSelector } from '../files/TagSelector'
import type { Repo } from '@/types'
import { X } from 'lucide-react'

interface RepoEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repo: Repo
}

export function RepoEditDialog({ open, onOpenChange, repo }: RepoEditDialogProps) {
  const { t } = useTranslation('repos')
  const { t: tc } = useTranslation('common')
  const { updateDescription, setRepoTags } = useRepoStore()

  const [description, setDescription] = useState(repo.description ?? '')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    repo.tags.map((tag) => tag.id)
  )

  useEffect(() => {
    if (open) {
      setDescription(repo.description ?? '')
      setSelectedTagIds(repo.tags.map((tag) => tag.id))
    }
  }, [open, repo])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = description.trim()
    await updateDescription(repo.id, trimmed || null)
    await setRepoTags(repo.id, selectedTagIds)
    onOpenChange(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl p-5 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{t('edit.title')}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('create.pathLabel')}
            </label>
            <div className="px-2.5 py-1.5 text-xs bg-secondary/50 border border-border rounded-md text-muted-foreground truncate" title={repo.path}>
              {repo.path}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('create.descriptionLabel')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <TagSelector selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
            >
              {tc('actions.cancel')}
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              {t('edit.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
