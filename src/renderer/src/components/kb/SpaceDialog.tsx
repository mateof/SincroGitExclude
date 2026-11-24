import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Folder, TriangleAlert, Info, ShieldCheck, LoaderCircle, Trash2, MoveRight } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import type { KbBackend, KbBackendConfig, KbSpace, KbSpaceInput } from '../../../../shared/kb/types'

interface PathCheck {
  exists: boolean
  isDirectory: boolean
  cloudSynced: boolean
  spaceMeta: { id: string; name: string } | null
  insideSpace: { spaceId: string; path: string } | null
}

const input = 'w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary'
const label = 'text-xs font-medium text-muted-foreground mb-1 block'

export function PathField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useTranslation('kb')
  return (
    <div className="flex gap-1.5">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={input} />
      <button
        type="button"
        onClick={async () => {
          const selected = await window.api.selectDirectory()
          if (selected) onChange(selected)
        }}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-secondary shrink-0"
      >
        <Folder className="w-3.5 h-3.5" />
        {t('dialog.browse')}
      </button>
    </div>
  )
}

export function SpaceDialog({ space, onClose }: { space?: KbSpace; onClose: () => void }) {
  const { t } = useTranslation('kb')
  const { loadSpaces, selectSpace } = useKbStore()
  const openKnowledge = useUIStore((s) => s.openKnowledge)
  const isWebMode = useUIStore((s) => s.isWebMode)
  const editing = !!space
  const [mode, setMode] = useState<'existing' | 'clone'>('existing')
  const [name, setName] = useState(space?.name ?? '')
  const [path, setPath] = useState(space?.localPath ?? '')
  const [check, setCheck] = useState<PathCheck | null>(null)
  const [backend, setBackend] = useState<KbBackend>(space?.backend ?? 'none')
  const [config, setConfig] = useState<KbBackendConfig>(space?.backendConfig ?? { branch: 'main', port: 22, auth: 'agent' })
  const [interval, setIntervalMin] = useState(space?.sync.intervalMin ?? 15)
  const [onWrite, setOnWrite] = useState(space?.sync.onWrite ?? true)
  const [autoCommit, setAutoCommit] = useState(space?.sync.autoCommitExternal ?? true)
  const [agentWrite, setAgentWrite] = useState(space?.agentWrite ?? true)
  const [review, setReview] = useState(space?.reviewBeforePush ?? false)
  const [shared, setShared] = useState(space?.shared ?? false)
  const [passphrase, setPassphrase] = useState('')
  const [probe, setProbe] = useState<{ fingerprint?: string; trusted?: boolean; ok?: boolean; branches?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relocating, setRelocating] = useState(false)
  const [relocateTarget, setRelocateTarget] = useState('')

  useEffect(() => {
    if (editing || !path) {
      setCheck(null)
      return
    }
    const timer = setTimeout(() => {
      kbCall<PathCheck>('kb:check-path', path)
        .then((c) => {
          setCheck(c)
          if (c.spaceMeta && !name) setName(c.spaceMeta.name)
        })
        .catch(() => setCheck(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [path, editing])

  const patch = (p: Partial<KbBackendConfig>): void => setConfig({ ...config, ...p })

  const payload = (): KbSpaceInput => ({
    name: name.trim() || undefined,
    localPath: path.trim(),
    backend,
    backendConfig: config,
    sync: { intervalMin: Number(interval) || 0, onWrite, autoCommitExternal: autoCommit },
    agentWrite,
    reviewBeforePush: review,
    shared
  })

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      let saved: KbSpace
      if (editing) {
        saved = await kbCall<KbSpace>('kb:update-space', space!.id, payload())
        if (backend === 'sftp' && passphrase) await kbCall('kb:set-sftp-passphrase', space!.id, passphrase)
      } else if (mode === 'clone') {
        saved = await kbCall<KbSpace>('kb:clone-space', {
          remoteUrl: config.remoteUrl ?? '',
          branch: config.branch || 'main',
          targetPath: path.trim(),
          name: name.trim() || undefined
        })
      } else {
        saved = await kbCall<KbSpace>('kb:add-space', payload())
        if (backend === 'sftp' && passphrase) await kbCall('kb:set-sftp-passphrase', saved.id, passphrase)
      }
      await loadSpaces()
      selectSpace(saved.id)
      openKnowledge()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    if (!space) return
    setBusy(true)
    setError(null)
    try {
      await kbCall('kb:update-space', space.id, { backend, backendConfig: config })
      if (backend === 'sftp' && passphrase) await kbCall('kb:set-sftp-passphrase', space.id, passphrase)
      setProbe(await kbCall('kb:test-backend', space.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const trust = async (): Promise<void> => {
    if (!space || !probe?.fingerprint) return
    const updated = await kbCall<KbSpace>('kb:trust-host', space.id, probe.fingerprint)
    setConfig(updated.backendConfig)
    setProbe({ ...probe, trusted: true })
  }

  const remove = async (): Promise<void> => {
    if (!space || !window.confirm(t('dialog.removeConfirm', { name: space.name }))) return
    await kbCall('kb:remove-space', space.id)
    await loadSpaces()
    onClose()
  }

  const relocate = async (): Promise<void> => {
    if (!space) return
    setBusy(true)
    setError(null)
    try {
      await kbCall('kb:relocate-space', space.id, relocateTarget.trim())
      await loadSpaces()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (checked: boolean, set: (v: boolean) => void, text: string, hint?: string) => (
    <label className="flex items-start gap-2 text-xs cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} className="mt-0.5" />
      <span>
        {text}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">{editing ? t('dialog.editTitle') : t('dialog.addTitle')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          {!editing && (
            <div className="flex gap-1 p-1 bg-secondary rounded-lg text-xs">
              {(['existing', 'clone'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    if (m === 'clone') setBackend('git')
                  }}
                  className={`flex-1 py-1.5 rounded-md ${mode === m ? 'bg-card shadow text-foreground' : 'text-muted-foreground'}`}
                >
                  {m === 'existing' ? t('dialog.modeExisting') : t('dialog.modeClone')}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3">
            <div>
              <span className={label}>{t('dialog.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="claude" />
            </div>
            <div>
              <span className={label}>{mode === 'clone' ? t('dialog.cloneTarget') : t('dialog.path')}</span>
              {editing ? (
                <div className="text-xs font-mono px-2.5 py-1.5 bg-secondary/60 rounded-md break-all">{space!.localPath}</div>
              ) : (
                <PathField value={path} onChange={setPath} placeholder="/Users/me/vaults/claude" />
              )}
              {check?.cloudSynced && (
                <p className="mt-1.5 text-[11px] text-warning flex gap-1">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                  {t('dialog.cloudWarning')}
                </p>
              )}
              {check?.spaceMeta && <p className="mt-1.5 text-[11px] text-muted-foreground">{t('dialog.existingMeta', { name: check.spaceMeta.name })}</p>}
              {check?.insideSpace && (
                <p className="mt-1.5 text-[11px] text-muted-foreground flex gap-1">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  {t('dialog.insideSpace', { name: useKbStore.getState().spaces.find((s) => s.id === check.insideSpace!.spaceId)?.name })}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold">{t('dialog.storage')}</div>
            {mode === 'existing' && (
              <div className="grid grid-cols-2 gap-1.5">
                {(['none', 'git', 'folder', 'sftp'] as KbBackend[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBackend(b)}
                    className={`px-2.5 py-2 text-xs rounded-lg border text-left ${backend === b ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary'}`}
                  >
                    {t(`dialog.backends.${b}`)}
                  </button>
                ))}
              </div>
            )}
            {backend === 'git' && (
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <div>
                  <span className={label}>{t('dialog.gitRemote')}</span>
                  <input value={config.remoteUrl ?? ''} onChange={(e) => patch({ remoteUrl: e.target.value })} className={input} placeholder="git@192.168.0.22:me/vault.git" />
                </div>
                <div>
                  <span className={label}>{t('dialog.gitBranch')}</span>
                  <input value={config.branch ?? 'main'} onChange={(e) => patch({ branch: e.target.value })} className={input} />
                </div>
                <p className="col-span-2 text-[11px] text-muted-foreground">{t('dialog.gitRemoteHint')}</p>
              </div>
            )}
            {backend === 'folder' && (
              <div>
                <span className={label}>{t('dialog.folderPath')}</span>
                <PathField value={config.path ?? ''} onChange={(v) => patch({ path: v })} placeholder="/Volumes/nas/vault" />
              </div>
            )}
            {backend === 'sftp' && (
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <div>
                  <span className={label}>{t('dialog.sftpHost')}</span>
                  <input value={config.host ?? ''} onChange={(e) => patch({ host: e.target.value })} className={input} placeholder="192.168.0.22" />
                </div>
                <div>
                  <span className={label}>{t('dialog.sftpPort')}</span>
                  <input type="number" value={config.port ?? 22} onChange={(e) => patch({ port: Number(e.target.value) })} className={input} />
                </div>
                <div>
                  <span className={label}>{t('dialog.sftpUser')}</span>
                  <input value={config.username ?? ''} onChange={(e) => patch({ username: e.target.value })} className={input} />
                </div>
                <div>
                  <span className={label}>{t('dialog.sftpAuth')}</span>
                  <select value={config.auth ?? 'agent'} onChange={(e) => patch({ auth: e.target.value as 'agent' | 'key' })} className={input}>
                    <option value="agent">{t('dialog.sftpAgent')}</option>
                    <option value="key">{t('dialog.sftpKey')}</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <span className={label}>{t('dialog.sftpPath')}</span>
                  <input value={config.remotePath ?? ''} onChange={(e) => patch({ remotePath: e.target.value })} className={input} placeholder="/volume1/vaults/claude" />
                </div>
                {config.auth === 'key' && (
                  <>
                    <div className="col-span-2">
                      <span className={label}>{t('dialog.sftpKeyPath')}</span>
                      <div className="flex gap-1.5">
                        <input value={config.privateKeyPath ?? ''} onChange={(e) => patch({ privateKeyPath: e.target.value })} className={input} placeholder="~/.ssh/id_ed25519" />
                        <button
                          type="button"
                          onClick={async () => {
                            const file = await window.api.selectFile()
                            if (file) patch({ privateKeyPath: file })
                          }}
                          className="px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-secondary"
                        >
                          {t('dialog.browse')}
                        </button>
                      </div>
                    </div>
                    {!isWebMode && (
                      <div className="col-span-2">
                        <span className={label}>{t('dialog.sftpPassphrase')}</span>
                        <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className={input} autoComplete="off" />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {editing && backend !== 'none' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void test()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-secondary"
                >
                  {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                  {t('dialog.test')}
                </button>
                {probe?.ok && !probe.fingerprint && <p className="text-[11px] text-success">{t('dialog.testOk')}</p>}
                {probe?.fingerprint && (
                  <div className="p-2.5 rounded-lg border border-border text-[11px] space-y-1.5">
                    <div className="font-mono break-all">{t('dialog.fingerprint', { fingerprint: probe.fingerprint })}</div>
                    {probe.trusted || config.hostFingerprint === probe.fingerprint ? (
                      <div className="text-success flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {t('dialog.fingerprintTrusted')}
                      </div>
                    ) : (
                      <>
                        <p className="text-muted-foreground">{t('dialog.trustHint')}</p>
                        <button type="button" onClick={() => void trust()} className="px-2.5 py-1 bg-primary text-primary-foreground rounded-md">
                          {t('dialog.trust')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {backend !== 'none' && mode === 'existing' && (
            <div className="space-y-2">
              <div className="text-xs font-semibold">{t('dialog.sync')}</div>
              <div className="flex items-center gap-2 text-xs">
                <span>{t('dialog.interval')}</span>
                <input
                  type="number"
                  min={0}
                  value={interval}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  className="w-16 px-2 py-1 bg-secondary border border-border rounded-md"
                />
                <span className="text-muted-foreground">{t('dialog.minutes')}</span>
              </div>
              {toggle(onWrite, setOnWrite, t('dialog.onWrite'))}
              {backend === 'git' && toggle(autoCommit, setAutoCommit, t('dialog.autoCommit'))}
            </div>
          )}

          {mode === 'existing' && (
            <div className="space-y-2">
              <div className="text-xs font-semibold">{t('dialog.access')}</div>
              {toggle(agentWrite, setAgentWrite, t('dialog.agentWrite'))}
              {toggle(review, setReview, t('dialog.reviewBeforePush'))}
              {toggle(shared, (v) => {
                setShared(v)
                if (v) setReview(true)
              }, t('dialog.shared'))}
            </div>
          )}

          {editing && space!.cloudSynced && !isWebMode && (
            <div className="p-3 rounded-lg border border-warning/40 bg-warning/5 space-y-2">
              <div className="text-xs font-semibold text-warning flex items-center gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5" />
                {t('dialog.relocateTitle')}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('dialog.relocateBody')}</p>
              {relocating ? (
                <>
                  <span className={label}>{t('dialog.relocateTarget')}</span>
                  <PathField value={relocateTarget} onChange={setRelocateTarget} placeholder="/Users/me/vaults/claude-local" />
                  <button
                    type="button"
                    disabled={busy || !relocateTarget}
                    onClick={() => void relocate()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-warning text-black rounded-md disabled:opacity-50"
                  >
                    <MoveRight className="w-3.5 h-3.5" />
                    {t('dialog.relocateConfirm')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setRelocating(true)} className="px-3 py-1.5 text-xs border border-warning/50 rounded-md">
                  {t('space.relocate')}
                </button>
              )}
            </div>
          )}

          {error && <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive select-text">{error}</div>}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          {editing ? (
            <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md">
              <Trash2 className="w-3.5 h-3.5" />
              {t('dialog.remove')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={busy || (!editing && !path.trim())}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
            {editing ? t('dialog.save') : mode === 'clone' ? t('dialog.clone') : t('dialog.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
