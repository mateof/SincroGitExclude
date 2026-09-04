import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpCircle, ExternalLink, RefreshCw } from 'lucide-react'
import {
  CHANNELS,
  channelOf,
  compareVersions,
  isChannel,
  pickRelease,
  type Channel
} from '@/lib/update-channels'

const GITHUB_REPO = 'mateof/SincroGitExclude'

interface UpdateCheckerProps {
  currentVersion: string
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
    status = (
      <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
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
        <a
          href={release.html_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault()
            window.api.invoke('shell:open-external', release.html_url)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          {t('update.download')}
        </a>
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
