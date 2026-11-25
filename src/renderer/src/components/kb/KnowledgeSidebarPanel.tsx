import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Search,
  Lock,
  Inbox,
  Paperclip,
  RefreshCw,
  Library
} from 'lucide-react'
import { useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import { foldText } from '../../../../shared/kb/wikilink'
import { SpaceDialog } from './SpaceDialog'
import type { KbTreeNode } from '../../../../shared/kb/types'

function filterTree(node: KbTreeNode, query: string): KbTreeNode | null {
  if (!query) return node
  if (node.type !== 'folder') {
    const hay = foldText(`${node.title ?? ''} ${node.path}`)
    return hay.includes(query) ? node : null
  }
  const children = (node.children ?? []).map((c) => filterTree(c, query)).filter((c): c is KbTreeNode => c !== null)
  if (children.length === 0 && node.path && !foldText(node.name).includes(query)) return null
  return { ...node, children }
}

function TreeItem({ spaceId, node, depth, forceOpen }: { spaceId: string; node: KbTreeNode; depth: number; forceOpen: boolean }) {
  const { expanded, toggleFolder, openNote, selectedPath, selectedSpaceId } = useKbStore()
  const openKnowledge = useUIStore((s) => s.openKnowledge)
  const pad = { paddingLeft: `${depth * 12 + 8}px` }
  if (node.type === 'folder') {
    const open = forceOpen || expanded[`${spaceId}:${node.path}`] === true
    const isInbox = node.name.toLowerCase() === 'inbox'
    return (
      <div>
        <button
          type="button"
          onClick={() => toggleFolder(spaceId, node.path)}
          className="w-full flex items-center gap-1.5 py-1 pr-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded-md"
          style={pad}
        >
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          {isInbox ? <Inbox className="w-3.5 h-3.5 shrink-0" /> : open ? <FolderOpen className="w-3.5 h-3.5 shrink-0" /> : <Folder className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate font-medium">{node.name}</span>
          {node.noteCount ? (
            <span className={`ml-auto text-[10px] tabular-nums ${isInbox && node.noteCount > 0 ? 'px-1.5 rounded-full bg-warning/15 text-warning' : 'opacity-60'}`}>
              {node.noteCount}
            </span>
          ) : null}
        </button>
        {open && node.children?.map((child) => <TreeItem key={child.path} spaceId={spaceId} node={child} depth={depth + 1} forceOpen={forceOpen} />)}
      </div>
    )
  }
  const active = selectedSpaceId === spaceId && selectedPath === node.path
  const isNote = node.type === 'note'
  return (
    <button
      type="button"
      disabled={!isNote}
      onClick={() => {
        openKnowledge()
        void openNote(spaceId, node.path)
      }}
      title={node.path}
      className={`w-full flex items-center gap-1.5 py-1 pr-2 text-xs rounded-md transition-colors ${
        active ? 'bg-primary/15 text-primary' : isNote ? 'text-foreground/85 hover:bg-secondary/60' : 'text-muted-foreground/70'
      }`}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
    >
      {isNote ? <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" /> : <Paperclip className="w-3.5 h-3.5 shrink-0 opacity-60" />}
      <span className="truncate">{isNote ? (node.title ?? node.name.replace(/\.md$/, '')) : node.name}</span>
    </button>
  )
}

export function KnowledgeSidebarPanel() {
  const { t } = useTranslation('kb')
  const { spaces, loaded, selectedSpaceId, trees, loadSpaces, selectSpace, setQuickOpen, showFiles, setShowFiles, syncing, syncNow } =
    useKbStore()
  const openKnowledge = useUIStore((s) => s.openKnowledge)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!loaded) void loadSpaces()
  }, [loaded, loadSpaces])

  const space = spaces.find((s) => s.id === selectedSpaceId) ?? null
  const tree = selectedSpaceId ? trees[selectedSpaceId] : undefined
  const query = foldText(filter.trim())
  const visible = useMemo(() => (tree ? filterTree(tree, query) : null), [tree, query])
  const depthOf = (id: string): number => {
    let d = 0
    let current = spaces.find((s) => s.id === id)
    while (current?.parentId && d < 5) {
      d++
      current = spaces.find((s) => s.id === current!.parentId)
    }
    return d
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-2 pb-2 space-y-2 border-b border-border">
        {spaces.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              value={selectedSpaceId ?? ''}
              onChange={(e) => {
                selectSpace(e.target.value)
                openKnowledge()
              }}
              className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {'· '.repeat(depthOf(s.id))}
                  {s.name}
                  {s.locked ? ` (${t('sidebar.locked')})` : ''}
                </option>
              ))}
            </select>
            {space && space.backend !== 'none' && (
              <button
                type="button"
                title={t('space.syncNow')}
                onClick={() => void syncNow(space.id)}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing[space.id] ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              title={t('sidebar.addSpace')}
              onClick={() => setAdding(true)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            openKnowledge()
            setQuickOpen(true)
          }}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground bg-secondary/60 border border-border rounded-md hover:text-foreground"
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t('sidebar.search')}</span>
          <kbd className="ml-auto text-[10px] opacity-70">{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        {tree && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('sidebar.filter')}
            className="w-full px-2 py-1 text-xs bg-transparent border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
          />
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {loaded && spaces.length === 0 && (
          <div className="p-3 text-center text-xs text-muted-foreground space-y-3">
            <Library className="w-6 h-6 mx-auto opacity-60" />
            <p>{t('sidebar.noSpaces')}</p>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('sidebar.addSpace')}
            </button>
          </div>
        )}
        {space?.locked && (
          <div className="m-2 p-2 text-xs rounded-md bg-warning/10 text-warning flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            {t('crypto.locked')}
          </div>
        )}
        {space && !space.exists && <div className="m-2 p-2 text-xs rounded-md bg-destructive/10 text-destructive">{t('sidebar.missing')}</div>}
        {visible?.children?.map((child) => (
          <TreeItem key={child.path} spaceId={space!.id} node={child} depth={0} forceOpen={query.length > 0} />
        ))}
      </div>
      {tree && (
        <label className="flex items-center gap-2 px-3 py-2 border-t border-border text-[11px] text-muted-foreground">
          <input type="checkbox" checked={showFiles} onChange={(e) => setShowFiles(e.target.checked)} />
          {t('sidebar.showFiles')}
        </label>
      )}
      {adding && <SpaceDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
