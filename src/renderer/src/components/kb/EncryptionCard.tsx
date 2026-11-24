import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, LockOpen, ShieldCheck, KeyRound, Laptop, Users, UserPlus, X, LoaderCircle, WandSparkles, TriangleAlert, Trash2 } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import type { KbCryptoStatus, KbSpace } from '../../../../shared/kb/types'

const input = 'w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary'
const primary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50'
const secondary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary disabled:opacity-50'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-xs">{children}</div>
      </div>
    </div>
  )
}

function PassphraseInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t, i18n } = useTranslation('kb')
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!value) {
      setProblem(null)
      return
    }
    const timer = setTimeout(() => {
      kbCall<{ problem: string | null }>('kb:crypto-check-passphrase', value).then((r) => setProblem(r.problem))
    }, 250)
    return () => clearTimeout(timer)
  }, [value])
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`${input} font-mono`} autoComplete="off" spellCheck={false} />
        <button
          type="button"
          className={secondary}
          onClick={async () => onChange((await kbCall<{ passphrase: string }>('kb:crypto-generate-passphrase', i18n.language)).passphrase)}
        >
          <WandSparkles className="w-3.5 h-3.5" />
          {t('crypto.generate')}
        </button>
      </div>
      {value && (problem ? <p className="text-warning">{problem}</p> : <p className="text-success">{t('crypto.strengthOk')}</p>)}
    </div>
  )
}

function WordGrid({ words }: { words: string[] }) {
  return (
    <ol className="grid grid-cols-3 gap-1.5 p-3 bg-secondary/60 rounded-lg font-mono select-text">
      {words.map((w, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
          <span>{w}</span>
        </li>
      ))}
    </ol>
  )
}

function EnableWizard({ space, canRemember, onDone, onClose }: { space: KbSpace; canRemember: boolean; onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation('kb')
  const [step, setStep] = useState(1)
  const [passphrase, setPassphrase] = useState('')
  const [remember, setRemember] = useState(canRemember)
  const [words, setWords] = useState<string[]>([])
  const [asked, setAsked] = useState<number[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prepare = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await kbCall<{ words: string[]; asked: number[] }>('kb:crypto-prepare', space.id, passphrase, remember)
      setWords(result.words)
      setAsked(result.asked)
      setStep(2)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await kbCall('kb:crypto-confirm', space.id, answers)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('crypto.wizardTitle', { name: space.name })} onClose={onClose}>
      <div className="flex gap-2 text-[11px]">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`flex-1 pb-1 border-b-2 ${step >= n ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}>
            {t(`crypto.step${n}`)}
          </span>
        ))}
      </div>
      {step === 1 && (
        <>
          <p className="text-muted-foreground">{t('crypto.wizardIntro')}</p>
          <p className="flex gap-1.5 text-warning">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
            {t('crypto.wizardRemote')}
          </p>
          <div>
            <div className="font-medium mb-1">{t('crypto.passphrase')}</div>
            <PassphraseInput value={passphrase} onChange={setPassphrase} />
          </div>
          {canRemember ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t('crypto.rememberDevice')}
            </label>
          ) : (
            <p className="text-muted-foreground">{t('crypto.noKeychain')}</p>
          )}
          <div className="flex justify-end">
            <button type="button" className={primary} disabled={busy || passphrase.length === 0} onClick={() => void prepare()}>
              {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
              {t('crypto.next')}
            </button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <p>{t('crypto.wordsIntro')}</p>
          <WordGrid words={words} />
          <div className="flex justify-end">
            <button type="button" className={primary} onClick={() => setStep(3)}>
              {t('crypto.next')}
            </button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <p>{t('crypto.wordsConfirm')}</p>
          <div className="grid grid-cols-3 gap-2">
            {asked.map((i) => (
              <label key={i} className="space-y-1">
                <span className="text-muted-foreground">{t('crypto.word', { n: i + 1 })}</span>
                <input
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                  className={`${input} font-mono`}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-between">
            <button type="button" className={secondary} onClick={() => setStep(2)}>
              {t('crypto.back')}
            </button>
            <button type="button" className={primary} disabled={busy} onClick={() => void confirm()}>
              {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
              <ShieldCheck className="w-3.5 h-3.5" />
              {t('crypto.finish')}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-destructive select-text">{error}</p>}
    </Modal>
  )
}

function UnlockDialog({ space, onDone, onClose }: { space: KbSpace; onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation('kb')
  const [useRecovery, setUseRecovery] = useState(false)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unlock = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await kbCall('kb:crypto-unlock', space.id, useRecovery ? { recovery: secret } : { passphrase: secret })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`${t('crypto.unlock')} · ${space.name}`} onClose={onClose}>
      <div className="font-medium">{useRecovery ? t('crypto.recovery') : t('crypto.passphrase')}</div>
      {useRecovery ? (
        <textarea value={secret} onChange={(e) => setSecret(e.target.value)} rows={4} className={`${input} font-mono`} spellCheck={false} />
      ) : (
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void unlock()}
          className={input}
          autoFocus
          autoComplete="off"
        />
      )}
      <div className="flex items-center justify-between">
        <button type="button" className="text-primary hover:underline" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? t('crypto.usePassphrase') : t('crypto.useRecovery')}
        </button>
        <button type="button" className={primary} disabled={busy || !secret} onClick={() => void unlock()}>
          {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <LockOpen className="w-3.5 h-3.5" />}
          {t('crypto.unlock')}
        </button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
    </Modal>
  )
}

export function EncryptionCard({ space }: { space: KbSpace }) {
  const { t } = useTranslation('kb')
  const isWebMode = useUIStore((s) => s.isWebMode)
  const loadSpaces = useKbStore((s) => s.loadSpaces)
  const [status, setStatus] = useState<KbCryptoStatus | null>(null)
  const [dialog, setDialog] = useState<'enable' | 'unlock' | 'passphrase' | null>(null)
  const [newWords, setNewWords] = useState<string[] | null>(null)
  const [newPass, setNewPass] = useState('')
  const [pairing, setPairing] = useState<{ words: string[]; deviceName: string } | null>(null)
  const [requested, setRequested] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setStatus(await kbCall<KbCryptoStatus>('kb:crypto-status', space.id))
      if (space.encrypted && !space.locked) setPairing(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
    if (space.encrypted && space.locked && !isWebMode) {
      kbCall<{ words: string[]; deviceName: string } | null>('kb:crypto-pairing-check', space.id)
        .then(setPairing)
        .catch(() => setPairing(null))
    }
  }, [space.id, space.encrypted, space.locked])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await loadSpaces()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const done = (): void => {
    setDialog(null)
    void loadSpaces().then(refresh)
  }

  return (
    <div className="kb-card">
      <div className="kb-card-title">
        {space.encrypted ? <ShieldCheck className="w-4 h-4 text-success" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
        {t('crypto.title')}
        {space.encrypted && (
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${space.locked ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
            {space.locked ? t('sidebar.locked') : t('crypto.unlocked')}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{space.encrypted ? t('crypto.on') : t('crypto.off')}</p>
      {isWebMode && space.encrypted && space.locked && <p className="text-xs text-muted-foreground">{t('crypto.locked')}</p>}

      {!isWebMode && !space.encrypted && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={space.backend === 'none'} onClick={() => setDialog('enable')} title={space.backend === 'none' ? t('crypto.needsBackend') : undefined}>
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('crypto.enable')}
          </button>
          {space.backend !== 'none' && (
            <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-adopt', space.id))} title={t('crypto.adoptHint')}>
              {t('crypto.adopt')}
            </button>
          )}
        </div>
      )}

      {!isWebMode && space.encrypted && space.locked && (
        <div className="space-y-2">
          {pairing ? (
            <div className="p-3 rounded-lg border border-primary/40 bg-primary/5 space-y-2 text-xs">
              <div className="font-semibold">{t('crypto.pairingTitle')}</div>
              <p className="text-muted-foreground">{t('crypto.pairingBody')}</p>
              <div className="font-mono text-sm">{pairing.words.join(' · ')}</div>
              <button type="button" className={primary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-confirm-pairing', space.id))}>
                {t('crypto.pairingConfirm')}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => setDialog('unlock')}>
              <LockOpen className="w-3.5 h-3.5" />
              {t('crypto.unlock')}
            </button>
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await kbCall<{ deviceName: string }>('kb:crypto-request-access', space.id)
                  setRequested(r.deviceName)
                })
              }
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('crypto.requestAccess')}
            </button>
          </div>
          {requested && <p className="text-xs text-muted-foreground">{t('crypto.requestSent', { name: requested })}</p>}
        </div>
      )}

      {!isWebMode && space.encrypted && !space.locked && status && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-lock', space.id))}>
              <Lock className="w-3.5 h-3.5" />
              {t('crypto.lock')}
            </button>
            {!status.remembered && status.canRememberOnDevice && (
              <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-remember-device', space.id))}>
                <Laptop className="w-3.5 h-3.5" />
                {t('crypto.rememberThis')}
              </button>
            )}
            <button type="button" className={secondary} onClick={() => setDialog('passphrase')}>
              <KeyRound className="w-3.5 h-3.5" />
              {t('crypto.changePassphrase')}
            </button>
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await kbCall<{ words: string[] }>('kb:crypto-reset-recovery', space.id)
                  setNewWords(r.words)
                })
              }
            >
              {t('crypto.newRecovery')}
            </button>
          </div>

          {status.pendingPairings.length > 0 && (
            <div className="p-3 rounded-lg border border-primary/40 bg-primary/5 space-y-2 text-xs">
              <div className="font-semibold">{t('crypto.pending')}</div>
              <p className="text-muted-foreground">{t('crypto.pendingHint')}</p>
              {status.pendingPairings.map((p) => (
                <div key={p.id} className="space-y-1.5 pt-2 border-t border-border/60">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-sm">{p.sas.join(' · ')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={primary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-approve', space.id, p.id, 'device', 'admin'))}>
                      {t('crypto.approveDevice')}
                    </button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-approve', space.id, p.id, 'member', 'writer'))}>
                      {t('crypto.approveWriter')}
                    </button>
                    <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-approve', space.id, p.id, 'member', 'reader'))}>
                      {t('crypto.approveReader')}
                    </button>
                    <button type="button" className={`${secondary} text-destructive`} disabled={busy} onClick={() => void run(() => kbCall('kb:crypto-reject', space.id, p.id))}>
                      {t('crypto.reject')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(['devices', 'members'] as const).map((group) => {
            const list = group === 'devices' ? status.devices : status.members
            if (list.length === 0) return null
            return (
              <div key={group}>
                <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                  {group === 'devices' ? <Laptop className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                  {t(`crypto.${group}`)}
                </div>
                {list.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs py-1">
                    <span className="font-medium">{r.name}</span>
                    {'role' in r && <span className="text-muted-foreground">({t(`crypto.roles.${(r as { role: string }).role}`)})</span>}
                    {r.isMe && <span className="text-primary">· {t('crypto.thisDevice')}</span>}
                    <span className="font-mono text-[10px] text-muted-foreground">{r.fingerprint}</span>
                    <button
                      type="button"
                      className="ml-auto p-1 rounded hover:bg-destructive/10 text-destructive"
                      title={t('crypto.remove')}
                      onClick={() => {
                        if (window.confirm(t('crypto.removeConfirm', { name: r.name }))) void run(() => kbCall('kb:crypto-remove-recipient', space.id, r.id))
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-xs text-destructive select-text">{error}</p>}

      {dialog === 'enable' && status && <EnableWizard space={space} canRemember={status.canRememberOnDevice} onDone={done} onClose={() => setDialog(null)} />}
      {dialog === 'unlock' && <UnlockDialog space={space} onDone={done} onClose={() => setDialog(null)} />}
      {dialog === 'passphrase' && (
        <Modal title={t('crypto.changePassphrase')} onClose={() => setDialog(null)}>
          <PassphraseInput value={newPass} onChange={setNewPass} />
          <div className="flex justify-end">
            <button
              type="button"
              className={primary}
              disabled={busy || !newPass}
              onClick={() =>
                void run(async () => {
                  await kbCall('kb:crypto-change-passphrase', space.id, newPass)
                  setNewPass('')
                  setDialog(null)
                })
              }
            >
              {t('dialog.save')}
            </button>
          </div>
          {error && <p className="text-destructive">{error}</p>}
        </Modal>
      )}
      {newWords && (
        <Modal title={t('crypto.newRecovery')} onClose={() => setNewWords(null)}>
          <p>{t('crypto.newRecoveryBody')}</p>
          <WordGrid words={newWords} />
        </Modal>
      )}
    </div>
  )
}
