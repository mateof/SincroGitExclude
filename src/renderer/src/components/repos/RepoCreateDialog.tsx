import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRepoStore } from '@/stores/repo-store'
import { TagSelector } from '../files/TagSelector'
import { X, Folder, FolderGit2, ShieldOff, Check } from 'lucide-react'

interface RepoCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCreateDialog({ open, onOpenChange }: RepoCreateDialogProps) {
  const { t } = useTranslation('repos')
  const { t: tc } = useTranslation('common')
  const { addRepo } = useRepoStore()

  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [validating, setValidating] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reset = () => {
    setPath('')
    setDescription('')
    setSelectedTagIds([])
    setIsGitRepo(null)
    setError(null)
  }

  const validatePath = async (candidate: string) => {
    if (!candidate) {
      setIsGitRepo(null)
      return
    }
    setValidating(true)
    const result = await window.api.invoke<{ success: boolean; data?: boolean }>(
      'exclude:is-git-repo',
      candidate
    )
    setIsGitRepo(result.success && result.data === true)
    setValidating(false)
  }

  const handleBrowse = async () => {
    const selected = await window.api.selectDirectory()
    if (selected) {
      setPath(selected)
      setError(null)
      await validatePath(selected)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!path || isGitRepo !== true || loading) return
    setLoading(true)
    setError(null)
    try {
      const repo = await addRepo(path, description.trim() || undefined, selectedTagIds)
      if (repo) {
        reset()
        onOpenChange(false)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl p-5 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{t('create.title')}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Path */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('create.pathLabel')}
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value)
                  setIsGitRepo(null)
                }}
                onBlur={() => path && validatePath(path)}
                placeholder="/path/to/repo"
                className="flex-1 px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-secondary transition-colors"
              >
                <Folder className="w-3.5 h-3.5" />
                {t('create.browse')}
              </button>
            </div>
            {validating && (
              <div className="mt-1.5 text-[11px] text-muted-foreground">...</div>
            )}
            {!validating && isGitRepo === true && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-success">
                <Check className="w-3 h-3" />
                {t('create.valid')}
                <FolderGit2 className="w-3 h-3 ml-1" />
              </div>
            )}
            {!validating && isGitRepo === false && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-destructive">
                <ShieldOff className="w-3 h-3" />
                {t('create.invalid')}
              </div>
            )}
          </div>

          {/* Description */}
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

          {/* Tags */}
          <TagSelector selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2.5 py-1.5">
              {error}
            </div>
          )}

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
              disabled={!path || isGitRepo !== true || loading}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {t('create.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
