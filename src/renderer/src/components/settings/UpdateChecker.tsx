import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpCircle, ExternalLink, RefreshCw } from 'lucide-react'

const GITHUB_REPO = 'mateof/SincroGitExclude'

interface UpdateCheckerProps {
  currentVersion: string
}

interface ReleaseInfo {
  tag_name: string
  html_url: string
}

function compareVersions(current: string, latest: string): number {
  const a = current.split('.').map(Number)
  const b = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0
    const bv = b[i] || 0
    if (av < bv) return -1
    if (av > bv) return 1
  }
  return 0
}

export function UpdateChecker({ currentVersion }: UpdateCheckerProps) {
  const { t } = useTranslation('settings')
  const [checking, setChecking] = useState(false)
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [hasUpdate, setHasUpdate] = useState(false)
  const [error, setError] = useState(false)
  const [checked, setChecked] = useState(false)

  const checkForUpdates = async () => {
    setChecking(true)
    setError(false)
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data: ReleaseInfo = await res.json()
      setRelease(data)
      const latestVersion = data.tag_name.replace(/^v/, '')
      setHasUpdate(compareVersions(currentVersion, latestVersion) < 0)
      setChecked(true)
    } catch {
      setError(true)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    checkForUpdates()
  }, [])

  if (checking && !checked) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        {t('update.checking')}
      </div>
    )
  }

  if (error) {
    return (
      <button
        onClick={checkForUpdates}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {t('update.checkError')}
      </button>
    )
  }

  if (hasUpdate && release) {
    const latestVersion = release.tag_name.replace(/^v/, '')
    return (
      <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg">
        <ArrowUpCircle className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">
            {t('update.available', { version: latestVersion })}
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
  }

  if (checked) {
    return (
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

  return null
}
