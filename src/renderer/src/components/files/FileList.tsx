import { useUIStore } from '@/stores/ui-store'
import type { ManagedFile } from '@/types'
import { FileText, FolderArchive } from 'lucide-react'
import { getFileIcon } from '@/lib/file-icons'

function FileIcon({ file, isSelected }: { file: ManagedFile; isSelected: boolean }) {
  if (file.type === 'bundle') {
    return (
      <FolderArchive
        className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
      />
    )
  }

  const iconInfo = file.useAutoIcon ? getFileIcon(file.name) : null

  if (iconInfo) {
    const Icon = iconInfo.icon
    return (
      <Icon
        className="w-4 h-4"
        style={isSelected ? { color: 'var(--color-primary)' } : { color: iconInfo.color }}
      />
    )
  }

  return (
    <FileText
      className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
    />
  )
}

interface FileListProps {
  files: ManagedFile[]
  changedFileIds?: Set<string>
}

export function FileList({ files, changedFileIds }: FileListProps) {
  const { selectedFileId, selectFile } = useUIStore()

  return (
    <div className="py-1">
      {files.map((file) => {
        const hasChanges = changedFileIds?.has(file.id)
        return (
        <button
          key={file.id}
          onClick={() => selectFile(file.id)}
          className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
            selectedFileId === file.id
              ? 'bg-primary/10 text-primary border-r-2 border-primary'
              : 'hover:bg-secondary text-foreground'
          }`}
        >
          <div className="relative shrink-0">
            <FileIcon file={file} isSelected={selectedFileId === file.id} />
            {hasChanges && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-warning" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{file.name}</div>
            <div className="text-[10px] text-muted-foreground truncate">{file.alias}</div>
            {file.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {file.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium"
                    style={{
                      backgroundColor: tag.color + '20',
                      color: tag.color
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
        )
      })}
    </div>
  )
}
