import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpCircle, ExternalLink } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { availableUpdate, useUpdateStore, type ReleaseInfo } from '@/stores/update-store'
import { channelOf } from '../../../../shared/update-channels'
import { isCheckDue, shouldNotify } from '../../../../shared/update-notice'

const FIRST_TICK_MS = 8_000
const TICK_MS = 30_000
const TYPING_PAUSE_MS = 5_000

function dialogIsOpen(): boolean {
  return document.querySelector('.fixed.inset-0, dialog[open]') !== null
}

function NoticeDialog({ release, currentVersion, onClose }: { release: ReleaseInfo; currentVersion: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('settings')
  const { startUpdate, snoozeNotice, dismissVersion } = useUpdateStore()
  const dialog = useRef<HTMLDialogElement>(null)
  const safeChoice = useRef<HTMLButtonElement>(null)
  const version = release.tag_name.replace(/^v/, '')
  const channel = channelOf(version)

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
    safeChoice.current?.focus()
  }, [])

  const handleClose = (): void => {
    const choice = dialog.current?.returnValue
    if (choice === 'update') startUpdate(version)
    else if (choice === 'dismiss') dismissVersion(version)
    else snoozeNotice()
    onClose()
  }

  const secondary = 'px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary transition-colors'
  return (
    <dialog
      ref={dialog}
      aria-labelledby="update-notice-title"
      onClose={handleClose}
      className="m-auto w-full max-w-md p-0 bg-card text-foreground border border-border rounded-xl shadow-xl overscroll-contain backdrop:bg-black/50 backdrop:overflow-hidden backdrop:overscroll-contain"
    >
      <form method="dialog" className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <ArrowUpCircle className="w-6 h-6 text-primary shrink-0" />
          <div className="min-w-0 space-y-1">
            <h1 id="update-notice-title" className="text-sm font-semibold">
              {t('update.notice.title', { version })}
              {channel !== 'stable' && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-normal rounded bg-secondary text-muted-foreground">
                  {t(`update.channel.${channel}`)}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {t('update.notice.current', { version: currentVersion })}
              {release.published_at &&
                ` · ${t('update.notice.published', {
                  date: new Date(release.published_at).toLocaleDateString(i18n.language === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium' })
                })}`}
            </p>
            <a
              href={release.html_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t('update.notice.changes')}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
        <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
          <li>{t('update.notice.snoozeHint')}</li>
          <li>{t('update.notice.dismissHint')}</li>
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button value="dismiss" className={secondary}>
            {t('update.notice.dismiss')}
          </button>
          <button ref={safeChoice} value="snooze" className={secondary}>
            {t('update.notice.snooze')}
          </button>
          <button
            value="update"
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            {t('update.updateNow')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function DesktopUpdateNotice() {
  const { currentVersion, channel, releases, notice, progress } = useUpdateStore()
  const inSettings = useUIStore((s) => s.currentView === 'settings')
  const [shown, setShown] = useState<ReleaseInfo | null>(null)
  const [tick, setTick] = useState(0)
  const lastKey = useRef(0)

  useEffect(() => {
    const onKey = (): void => {
      lastKey.current = Date.now()
    }
    const onTick = async (): Promise<void> => {
      const store = useUpdateStore.getState()
      await store.init()
      if (isCheckDue(useUpdateStore.getState().lastCheck, Date.now())) await store.check()
      setTick((n) => n + 1)
    }
    const run = (): void => void onTick().catch(() => undefined)
    const first = setTimeout(run, FIRST_TICK_MS)
    const timer = setInterval(run, TICK_MS)
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  useEffect(() => {
    if (tick === 0 || shown || inSettings || !currentVersion) return
    if (progress && progress.phase !== 'idle') return
    const release = availableUpdate({ releases, channel, currentVersion })
    if (!release || !shouldNotify(currentVersion, release.tag_name, notice, Date.now())) return
    if (dialogIsOpen() || Date.now() - lastKey.current < TYPING_PAUSE_MS) return
    setShown(release)
  }, [tick, shown, inSettings, currentVersion, progress, releases, channel, notice])

  if (!shown || !currentVersion) return null
  return <NoticeDialog release={shown} currentVersion={currentVersion} onClose={() => setShown(null)} />
}

export function UpdateNotice() {
  const isWebMode = useUIStore((s) => s.isWebMode)
  return isWebMode ? null : <DesktopUpdateNotice />
}
