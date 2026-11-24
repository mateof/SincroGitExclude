import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Library, Link2, Unlink, FileText, LoaderCircle, Lightbulb, Check, Info } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import type {
  KbRepoIntegrations,
  KbRepoLink,
  KbRepoLinkInput,
  KbRepoLinkPlanItem,
  KbRepoSuggestion,
  KbSpace
} from '../../../../shared/kb/types'

const input = 'w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary'

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function RepoKnowledgeTab({ repoId, repoPath }: { repoId: string; repoPath: string }) {
  const { t, i18n } = useTranslation('kb')
  const { spaces, loaded, loadSpaces, openNote } = useKbStore()
  const openKnowledge = useUIStore((s) => s.openKnowledge)
  const isWebMode = useUIStore((s) => s.isWebMode)
  const [link, setLink] = useState<KbRepoLink | null>(null)
  const [suggestion, setSuggestion] = useState<KbRepoSuggestion | null>(null)
  const [editing, setEditing] = useState(false)
  const [spaceId, setSpaceId] = useState('')
  const [notePath, setNotePath] = useState('')
  const [createNote, setCreateNote] = useState(true)
  const [integrations, setIntegrations] = useState<KbRepoIntegrations>({ pointer: true, mcpJson: true, sessionHook: true, agentsMd: true })
  const [remoteMode, setRemoteMode] = useState(false)
  const [remote, setRemote] = useState({ mcpUrl: '', spaceName: '' })
  const [plan, setPlan] = useState<{ items: KbRepoLinkPlanItem[]; noteExists: boolean } | null>(null)
  const [result, setResult] = useState<KbRepoLinkPlanItem[] | null>(null)
  const [forget, setForget] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoName = repoPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'repo'

  const load = async (): Promise<void> => {
    const current = await kbCall<KbRepoLink | null>('kb:repo-link-get', repoId)
    setLink(current)
    if (!current) {
      const suggestions = await kbCall<KbRepoSuggestion[]>('kb:repo-suggestions').catch(() => [])
      setSuggestion(suggestions.find((s) => s.repoId === repoId) ?? null)
    }
  }

  useEffect(() => {
    if (!loaded) void loadSpaces()
    void load().catch((e: Error) => setError(e.message))
  }, [repoId])

  useEffect(() => {
    if (!spaceId && spaces[0]) setSpaceId(spaces[0].id)
    if (!notePath) setNotePath(`projects/${slugify(repoName)}.md`)
  }, [spaces])

  const buildInput = (): KbRepoLinkInput => ({
    repoPath,
    spaceId: remoteMode ? spaceId.trim() : spaceId,
    notePath: notePath.trim(),
    createNote,
    language: i18n.language === 'en' ? 'en' : 'es',
    integrations,
    remote: remoteMode ? remote : undefined
  })

  useEffect(() => {
    if (!editing || !notePath.trim() || (!remoteMode && !spaceId)) return
    const timer = setTimeout(() => {
      kbCall<{ items: KbRepoLinkPlanItem[]; noteExists: boolean }>('kb:repo-link-preview', buildInput())
        .then((p) => {
          setPlan(p)
          setError(null)
        })
        .catch((e: Error) => setError(e.message))
    }, 300)
    return () => clearTimeout(timer)
  }, [editing, spaceId, notePath, integrations, remoteMode, remote.mcpUrl, remote.spaceName])

  const apply = async (overrides?: Partial<KbRepoLinkInput>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const response = await kbCall<{ link: KbRepoLink; plan: KbRepoLinkPlanItem[] }>('kb:repo-link', { ...buildInput(), ...overrides })
      setLink(response.link)
      setResult(response.plan)
      setEditing(false)
      setSuggestion(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (): Promise<void> => {
    if (!window.confirm(t('repo.unlinkConfirm'))) return
    setBusy(true)
    try {
      setResult(await kbCall<KbRepoLinkPlanItem[]>('kb:repo-unlink', repoId, { forgetInVault: forget }))
      setLink(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const spaceName = (id: string): string => spaces.find((s: KbSpace) => s.id === id)?.name ?? link?.remote?.spaceName ?? id
  const checkbox = (key: keyof KbRepoIntegrations) => (
    <label key={key} className="flex items-start gap-2 text-xs cursor-pointer">
      <input
        type="checkbox"
        checked={integrations[key]}
        onChange={(e) => setIntegrations({ ...integrations, [key]: e.target.checked })}
        className="mt-0.5"
      />
      <span>
        <span className="font-mono">{t(`repo.${key}`)}</span>
        <span className="block text-[11px] text-muted-foreground">{t(`repo.${key}Hint`)}</span>
      </span>
    </label>
  )

  return (
    <div className="space-y-4">
      {suggestion && !link && !editing && (
        <div className="kb-alert kb-alert-info">
          <Lightbulb className="w-4 h-4 shrink-0" />
          <div className="flex-1">{t('repo.suggestion', { note: suggestion.notePath })}</div>
          {!isWebMode && (
            <button
              type="button"
              disabled={busy}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md"
              onClick={() => void apply({ spaceId: suggestion.spaceId, notePath: suggestion.notePath, createNote: false, remote: undefined })}
            >
              {t('repo.suggestionApply')}
            </button>
          )}
        </div>
      )}

      {link && !editing && (
        <div className="kb-card">
          <div className="kb-card-title">
            <Library className="w-4 h-4 text-primary" />
            {t('repo.linked', { note: link.notePath, space: spaceName(link.spaceId) })}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {(Object.keys(link.integrations) as Array<keyof KbRepoIntegrations>)
              .filter((k) => link.integrations[k])
              .map((k) => (
                <span key={k} className="kb-badge font-mono">
                  <Check className="w-3 h-3" />
                  {t(`repo.${k}`)}
                </span>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {!link.remote && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg"
                onClick={() => {
                  openKnowledge()
                  void openNote(link.spaceId, link.notePath)
                }}
              >
                <FileText className="w-3.5 h-3.5" />
                {t('repo.openNote')}
              </button>
            )}
            {!isWebMode && (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary"
                  onClick={() => {
                    setSpaceId(link.spaceId)
                    setNotePath(link.notePath)
                    setIntegrations(link.integrations)
                    setRemoteMode(!!link.remote)
                    if (link.remote) setRemote(link.remote)
                    setEditing(true)
                  }}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  {t('repo.relink')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-lg"
                  onClick={() => void unlink()}
                >
                  <Unlink className="w-3.5 h-3.5" />
                  {t('repo.unlink')}
                </button>
              </>
            )}
          </div>
          {!isWebMode && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} />
              {t('repo.forgetInVault')}
            </label>
          )}
        </div>
      )}

      {!link && !editing && (
        <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border rounded-lg space-y-3">
          <Library className="w-6 h-6 mx-auto opacity-60" />
          <p>{t('repo.notLinked')}</p>
          {!isWebMode && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg"
            >
              <Link2 className="w-3.5 h-3.5" />
              {t('repo.link')}
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="kb-card">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={remoteMode} onChange={(e) => setRemoteMode(e.target.checked)} />
            {t('repo.remoteMode')}
          </label>
          {remoteMode ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs space-y-1">
                <span className="text-muted-foreground">{t('repo.remoteUrl')}</span>
                <input value={remote.mcpUrl} onChange={(e) => setRemote({ ...remote, mcpUrl: e.target.value })} className={input} placeholder="http://100.64.0.2:8766/mcp" />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">{t('repo.remoteSpaceId')}</span>
                <input value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className={`${input} font-mono`} />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">{t('repo.remoteSpaceName')}</span>
                <input value={remote.spaceName} onChange={(e) => setRemote({ ...remote, spaceName: e.target.value })} className={input} />
              </label>
            </div>
          ) : (
            <label className="text-xs space-y-1 block">
              <span className="text-muted-foreground">{t('repo.space')}</span>
              <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} className={input}>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">{t('repo.note')}</span>
            <input value={notePath} onChange={(e) => setNotePath(e.target.value)} className={`${input} font-mono`} placeholder={t('repo.notePlaceholder')} />
            {plan && !remoteMode && (
              <span className={`text-[11px] ${plan.noteExists ? 'text-success' : 'text-muted-foreground'}`}>
                {plan.noteExists ? t('repo.noteExists') : t('repo.noteMissing')}
              </span>
            )}
          </label>
          {!remoteMode && plan && !plan.noteExists && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={createNote} onChange={(e) => setCreateNote(e.target.checked)} />
              {t('repo.createNote')}
            </label>
          )}
          <div className="space-y-2">
            <div className="text-xs font-semibold">{t('repo.integrations')}</div>
            {(['pointer', 'mcpJson', 'sessionHook', 'agentsMd'] as const).map(checkbox)}
            <p className="text-[11px] text-muted-foreground flex gap-1">
              <Info className="w-3.5 h-3.5 shrink-0" />
              {t('repo.worktreeNote')}
            </p>
          </div>
          {plan && (
            <div className="space-y-1">
              <div className="text-xs font-semibold">{t('repo.preview')}</div>
              {plan.items.map((item) => (
                <div key={item.file} className="flex items-baseline gap-2 text-[11px]">
                  <span
                    className={`w-16 shrink-0 ${item.action === 'skip' ? 'text-muted-foreground' : item.action === 'create' ? 'text-success' : 'text-primary'}`}
                  >
                    {t(`repo.actions.${item.action}`)}
                  </span>
                  <span className="font-mono">{item.file}</span>
                  {item.reason && <span className="text-muted-foreground">· {item.reason}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary">
              {t('crypto.back')}
            </button>
            <button
              type="button"
              disabled={busy || !notePath.trim() || !spaceId}
              onClick={() => void apply()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
            >
              {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
              {t('repo.apply')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="text-[11px] space-y-0.5 text-muted-foreground">
          {result.map((item) => (
            <div key={item.file}>
              {t(`repo.actions.${item.action}`)} <span className="font-mono">{item.file}</span>
              {item.reason ? ` · ${item.reason}` : ''}
            </div>
          ))}
        </div>
      )}
      {error && <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive select-text">{error}</div>}
    </div>
  )
}
