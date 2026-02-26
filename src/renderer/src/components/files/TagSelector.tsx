import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/file-store'
import type { FileTag } from '@/types'
import { Plus, X } from 'lucide-react'

const TAG_COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'green', value: '#22c55e' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'purple', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
  { name: 'gray', value: '#6b7280' }
]

interface TagSelectorProps {
  selectedTagIds: string[]
  onChange: (tagIds: string[]) => void
}

export function TagSelector({ selectedTagIds, onChange }: TagSelectorProps) {
  const { t } = useTranslation('files')
  const { tags, loadTags, createTag } = useFileStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[4].value)

  useEffect(() => {
    loadTags()
  }, [loadTags])

  const toggleTag = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId))
    } else {
      onChange([...selectedTagIds, tagId])
    }
  }

  const handleCreateTag = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return

    const tag = await createTag(trimmed, newColor)
    if (tag) {
      onChange([...selectedTagIds, tag.id])
      setNewName('')
      setNewColor(TAG_COLORS[4].value)
      setShowCreate(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreateTag()
    }
    if (e.key === 'Escape') {
      setShowCreate(false)
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
        {t('tags.label')}
      </label>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border"
              style={{
                backgroundColor: selected ? tag.color + '25' : 'transparent',
                borderColor: selected ? tag.color : 'var(--color-border)',
                color: selected ? tag.color : 'var(--color-muted-foreground)'
              }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
              {selected && <X className="w-2.5 h-2.5 ml-0.5" />}
            </button>
          )
        })}

        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-muted-foreground border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
            {t('tags.create')}
          </button>
        )}
      </div>

      {showCreate && (
        <div className="p-2.5 bg-secondary/50 rounded-lg border border-border space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('tags.namePlaceholder')}
            autoFocus
            className="w-full px-2.5 py-1.5 text-xs bg-background rounded border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t('tags.selectColor')}:
            </span>
            <div className="flex gap-1.5">
              {TAG_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setNewColor(c.value)}
                  className="w-5 h-5 rounded-full transition-transform"
                  style={{
                    backgroundColor: c.value,
                    outline: newColor === c.value ? '2px solid ' + c.value : 'none',
                    outlineOffset: '2px',
                    transform: newColor === c.value ? 'scale(1.15)' : 'scale(1)'
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-2.5 py-1 text-[11px] rounded hover:bg-secondary transition-colors text-muted-foreground"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleCreateTag}
              disabled={!newName.trim()}
              className="px-3 py-1 text-[11px] bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
