import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpCircle, Download, ExternalLink, RefreshCw, RotateCw, X } from 'lucide-react'
import {
  CHANNELS,
  channelOf,
  compareVersions,
  isChannel,
  pickRelease,
  type Channel
} from '../../../../shared/update-channels'

import type { UpdateCapability, UpdateState } from '../../../../shared/update-types'

const GITHUB_REPO = 'mateof/SincroGitExclude'
const UPDATE_BLOCKERS = ['translocated', 'disk-image', 'not-writable']

interface UpdateCheckerProps {
  currentVersion: string
}

interface Reply<T> {
  success: boolean
  data?: T
  error?: string
}

interface ReleaseInfo {
  tag_name: string
  html_url: string
  draft?: boolean
}

function loadChannel(currentVersion: string): Channel {
  const stored = localStorage.getItem('updateChannel')
  if (isChannel(stored)) return stored
  // A prerelease build follows its own channel until told otherwise, so a dev
  // install keeps getting dev builds without touching settings first.
  return channelOf(currentVersion)
}

export function UpdateChecker({ currentVersion }: UpdateCheckerProps) {
  const { t } = useTranslation('settings')
  const [channel, setChannel] = useState<Channel>(() => loadChannel(currentVersion))
  const [checking, setChecking] = useState(false)
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [hasUpdate, setHasUpdate] = useState(false)
  const [error, setError] = useState(false)
  const [checked, setChecked] = useState(false)
  const [capability, setCapability] = useState<UpdateCapability | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.invoke<Reply<UpdateCapability>>('update:capability').then((r) => setCapability(r.data ?? null))
    void window.api.invoke<Reply<UpdateState>>('update:state').then((r) => setUpdate(r.data ?? null))
    return window.api.on('update:state', (state) => setUpdate(state as UpdateState))
  }, [])

  const runUpdate = async (action: 'download' | 'cancel' | 'install', version?: string) => {
    setUpdateError(null)
    const reply = await window.api.invoke<Reply<UpdateState>>(`update:${action}`, ...(version ? [version] : []))
    if (!reply.success) setUpdateError(reply.error ?? '')
  }

  const checkForUpdates = useCallback(async () => {
    setChecking(true)
    setError(false)
    try {
      // The whole list, not /releases/latest: that endpoint never returns a
      // prerelease, so beta and dev would always look up to date.
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`)
      if (!res.ok) throw new Error('Failed to fetch')
      const releases: ReleaseInfo[] = await res.json()

      const newest = pickRelease(releases, channel)
      setRelease(newest)
      setHasUpdate(!!newest && compareVersions(currentVersion, newest.tag_name) < 0)
      setChecked(true)
    } catch {
      setError(true)
    } finally {
      setChecking(false)
    }
  }, [channel, currentVersion])

  useEffect(() => {
    checkForUpdates()
  }, [checkForUpdates])

  const handleChannelChange = (value: Channel) => {
    if (value === channel) return
    localStorage.setItem('updateChannel', value)
    setChecked(false)
    setRelease(null)
    setHasUpdate(false)
    setChannel(value)
  }

  const selector = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">{t('update.channel.label')}:</span>
      <div className="flex gap-1">
        {CHANNELS.map((value) => (
          <button
            key={value}
            onClick={() => handleChannelChange(value)}
            title={t(`update.channel.${value}Hint`)}
            className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors ${
              channel === value
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            {t(`update.channel.${value}`)}
          </button>
        ))}
      </div>
    </div>
  )

  let status: JSX.Element | null = null

  if (checking && !checked) {
    status = (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        {t('update.checking')}
      </div>
    )
  } else if (error) {
    status = (
      <button
        onClick={checkForUpdates}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {t('update.checkError')}
      </button>
    )
  } else if (hasUpdate && release) {
    const latestVersion = release.tag_name.replace(/^v/, '')
    const latestChannel = channelOf(release.tag_name)
    const phase = capability?.supported && update?.version === latestVersion ? update.phase : 'idle'
    const percent = update && update.total > 0 ? Math.floor((update.received / update.total) * 100) : 0
    const buttonClass =
      'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shrink-0'
    status = (
      <div className="p-3 bg-primary/10 rounded-lg space-y-2">
        <div className="flex items-center gap-3">
          <ArrowUpCircle className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">
              {t('update.available', { version: latestVersion })}
              {latestChannel !== 'stable' && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded bg-secondary text-muted-foreground">
                  {t(`update.channel.${latestChannel}`)}
                </span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t('update.current', { version: currentVersion })}
            </p>
          </div>
          {capability?.supported && phase === 'idle' && (
            <button onClick={() => runUpdate('download', latestVersion)} className={buttonClass}>
              <Download className="w-3 h-3" />
              {t('update.updateNow')}
            </button>
          )}
          {phase === 'ready' && (
            <button onClick={() => runUpdate('install')} className={buttonClass}>
              <RotateCw className="w-3 h-3" />
              {t('update.restart')}
            </button>
          )}
          {(phase === 'downloading' || phase === 'verifying') && (
            <button
              onClick={() => runUpdate('cancel')}
              title={t('update.cancel')}
              className="p-1 rounded hover:bg-secondary transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {phase === 'idle' && (
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault()
                window.api.invoke('shell:open-external', release.html_url)
              }}
              className={
                capability?.supported
                  ? 'inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0'
                  : buttonClass
              }
            >
              <ExternalLink className="w-3 h-3" />
              {t('update.download')}
            </a>
          )}
        </div>
        {(phase === 'downloading' || phase === 'verifying') && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {phase === 'downloading' ? t('update.downloading', { percent }) : t('update.verifying')}
            </p>
          </div>
        )}
        {phase === 'ready' && <p className="text-[10px] text-muted-foreground">{t('update.readyHint')}</p>}
        {phase === 'installing' && <p className="text-[10px] text-muted-foreground">{t('update.installing')}</p>}
        {update?.installFailed && phase === 'idle' && (
          <p className="text-[10px] text-destructive">{t('update.installFailed')}</p>
        )}
        {updateError !== null && <p className="text-[10px] text-destructive">{t('update.failed', { error: updateError })}</p>}
        {capability?.blocker && UPDATE_BLOCKERS.includes(capability.blocker) && (
          <p className="text-[10px] text-muted-foreground">{t(`update.blocked.${capability.blocker}`)}</p>
        )}
      </div>
    )
  } else if (checked) {
    status = (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t('update.upToDate', { version: currentVersion })}</span>
        <button
          onClick={checkForUpdates}
          disabled={checking}
          className="p-0.5 rounded hover:bg-secondary transition-colors"
          title={t('update.checkAgain')}
        >
          <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {selector}
      {status}
    </div>
  )
}
