import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Folder,
  FolderGit2,
  File as FileIcon,
  ChevronRight,
  CornerLeftUp,
  Home,
  HardDrive,
  RefreshCw
} from 'lucide-react'
import type { IpcResult } from '@/types'
import type { PickerRequest, PickerResult } from '@/lib/remote-picker-bridge'

interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
  isGitRepo: boolean
}

interface BrowseData {
  path: string
  parent: string | null
  isGitRepo: boolean
  entries: BrowseEntry[]
  roots: string[]
  home: string
}

interface RemotePathPickerProps {
  request: PickerRequest
  onResolve: (result: PickerResult) => void
}

/** Which entries can be picked (as opposed to merely navigated into). */
function isSelectable(mode: PickerRequest['mode'], entry: BrowseEntry): boolean {
  switch (mode) {
    case 'file':
    case 'files':
      return !entry.isDirectory
    case 'directory':
      return entry.isDirectory
    case 'items':
      return true
    case 'save':
      return false
  }
}

function allowsMultiple(mode: PickerRequest['mode']): boolean {
  return mode === 'files' || mode === 'items'
}

/**
 * Filesystem browser for browser clients, which have no native dialogs.
 *
 * Walks the *server's* filesystem through the `fs:browse` channel and returns
 * absolute paths, exactly what the native dialogs return, so the resolvers
 * downstream cannot tell the difference.
 */
export function RemotePathPicker({ request, onResolve }: RemotePathPickerProps) {
  const { t } = useTranslation('common')

  const [data, setData] = useState<BrowseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [fileName, setFileName] = useState(request.defaultName || '')
  const [pathInput, setPathInput] = useState('')

  const browse = useCallback(async (target?: string) => {
    setLoading(true)
    setError(null)
    const result = await window.api.invoke<IpcResult<BrowseData>>('fs:browse', target)
    if (result?.success && result.data) {
      setData(result.data)
      setPathInput(result.data.path)
      setSelected([])
    } else {
      setError(result?.error || t('remotePicker.browseFailed'))
    }
    setLoading(false)
  }, [t])

  useEffect(() => {
    browse(request.defaultPath)
  }, [browse, request.defaultPath])

  // Escape closes, like the other dialogs in the app
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onResolve(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve])

  const toggle = (entry: BrowseEntry): void => {
    if (!isSelectable(request.mode, entry)) return
    setSelected((current) => {
      if (current.includes(entry.path)) {
        return current.filter((p) => p !== entry.path)
      }
      return allowsMultiple(request.mode) ? [...current, entry.path] : [entry.path]
    })
  }

  const confirm = (): void => {
    if (request.mode === 'save') {
      const name = fileName.trim()
      if (!name || !data) return
      onResolve([`${data.path.replace(/\/$/, '')}/${name}`])
      return
    }

    // In directory mode, confirming without a highlighted row means "this folder"
    if (request.mode === 'directory' && selected.length === 0 && data) {
      onResolve([data.path])
      return
    }

    if (selected.length === 0) return
    onResolve(selected)
  }

  const canConfirm =
    request.mode === 'save'
      ? fileName.trim().length > 0 && !!data
      : request.mode === 'directory'
        ? !!data
        : selected.length > 0

  const title = t(`remotePicker.title.${request.mode}`)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onResolve(null)} />

      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t('remotePicker.serverHint')}
            </p>
          </div>
          <button
            onClick={() => onResolve(null)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
            aria-label={t('actions.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation bar */}
        <div className="px-5 py-3 border-b border-border space-y-2">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => data?.parent && browse(data.parent)}
              disabled={!data?.parent}
              className="p-1.5 border border-border rounded-md hover:bg-secondary disabled:opacity-40 transition-colors"
              title={t('remotePicker.up')}
            >
              <CornerLeftUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => data && browse(data.home)}
              className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
              title={t('remotePicker.home')}
            >
              <Home className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => browse(data?.path)}
              className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
              title={t('actions.refresh')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  browse(pathInput)
                }
              }}
              spellCheck={false}
              className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {data && data.roots.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {data.roots.map((root) => (
                <button
                  key={root}
                  type="button"
                  onClick={() => browse(root)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border border-border rounded hover:bg-secondary transition-colors"
                >
                  <HardDrive className="w-3 h-3" />
                  {root}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto min-h-[240px]">
          {loading && (
            <div className="p-5 text-xs text-muted-foreground">{t('labels.loading')}</div>
          )}

          {!loading && error && (
            <div className="m-5 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2.5 py-1.5">
              {error}
            </div>
          )}

          {!loading && !error && data && data.entries.length === 0 && (
            <div className="p-5 text-xs text-muted-foreground">{t('remotePicker.empty')}</div>
          )}

          {!loading &&
            !error &&
            data?.entries.map((entry) => {
              const selectable = isSelectable(request.mode, entry)
              const isSelected = selected.includes(entry.path)
              return (
                <div
                  key={entry.path}
                  onClick={() => toggle(entry)}
                  onDoubleClick={() => entry.isDirectory && browse(entry.path)}
                  className={`flex items-center gap-2 px-5 py-1.5 border-b border-border/40 ${
                    isSelected ? 'bg-primary/15' : selectable ? 'hover:bg-secondary' : ''
                  } ${selectable ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  {entry.isDirectory ? (
                    entry.isGitRepo ? (
                      <FolderGit2 className="w-4 h-4 shrink-0 text-success" />
                    ) : (
                      <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                  )}

                  <span
                    className={`flex-1 text-xs truncate ${
                      selectable ? '' : 'text-muted-foreground'
                    }`}
                  >
                    {entry.name}
                  </span>

                  {entry.isDirectory && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        browse(entry.path)
                      }}
                      className="p-0.5 rounded hover:bg-border text-muted-foreground"
                      title={t('remotePicker.open')}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border space-y-3">
          {request.mode === 'save' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('remotePicker.fileName')}
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                spellCheck={false}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground truncate">
              {request.mode === 'directory' && selected.length === 0
                ? t('remotePicker.willUseCurrent')
                : selected.length > 0
                  ? t('remotePicker.selectedCount', { count: selected.length })
                  : t('remotePicker.nothingSelected')}
            </span>

            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onResolve(null)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!canConfirm}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
