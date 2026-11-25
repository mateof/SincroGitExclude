import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudUpload, CloudDownload, GitBranch, PlugZap, Save, AlertTriangle } from 'lucide-react'
import type { IpcResult } from '@/types'
import { useFileStore } from '@/stores/file-store'
import { useWatcherStore } from '@/stores/watcher-store'

interface SyncConfig {
  remoteUrl: string
  machineId: string
  machineName: string
  lastPushAt: string | null
  lastPullAt: string | null
}

interface SyncIssue {
  fileId: string
  fileName: string
  detail: string
}

interface SyncReport {
  direction: 'push' | 'pull'
  pushed: number
  upToDate: number
  created: number
  updated: number
  fastForwarded: number
  conflicts: SyncIssue[]
  errors: SyncIssue[]
  deletedRemotely: SyncIssue[]
  finishedAt: string
}

type Busy = null | 'save' | 'test' | 'push' | 'pull'

export function SyncSettings() {
  const { t, i18n } = useTranslation('settings')
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [urlDraft, setUrlDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)

  const applyConfig = useCallback((data: SyncConfig) => {
    setConfig(data)
    setUrlDraft(data.remoteUrl)
    setNameDraft(data.machineName)
  }, [])

  useEffect(() => {
    window.api.invoke<IpcResult<SyncConfig>>('sync:get-config').then((result) => {
      if (result.success && result.data) applyConfig(result.data)
      else setError(result.error || 'Error')
    })
  }, [applyConfig])

  const dirty =
    config !== null && (urlDraft.trim() !== config.remoteUrl || nameDraft.trim() !== config.machineName)

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString(i18n.language) : t('sync.never')

  const save = async () => {
    setBusy('save')
    setError(null)
    setNotice(null)
    const result = await window.api.invoke<IpcResult<SyncConfig>>('sync:set-config', {
      remoteUrl: urlDraft,
      machineName: nameDraft
    })
    setBusy(null)
    if (result.success && result.data) applyConfig(result.data)
    else setError(result.error || 'Error')
  }

  const test = async () => {
    setBusy('test')
    setError(null)
    setNotice(null)
    const result = await window.api.invoke<IpcResult<{ refs: number; files: number }>>(
      'sync:test',
      urlDraft.trim()
    )
    setBusy(null)
    if (result.success && result.data) setNotice(t('sync.testOk', { files: result.data.files }))
    else setError(result.error || 'Error')
  }

  const run = async (direction: 'push' | 'pull') => {
    if (dirty) await save()
    setBusy(direction)
    setError(null)
    setNotice(null)
    const result = await window.api.invoke<IpcResult<SyncReport>>(`sync:${direction}`)
    setBusy(null)
    if (result.success && result.data) {
      setReport(result.data)
      const refreshed = await window.api.invoke<IpcResult<SyncConfig>>('sync:get-config')
      if (refreshed.success && refreshed.data) setConfig(refreshed.data)
      if (direction === 'pull') {
        await Promise.all([useFileStore.getState().loadFiles(), useFileStore.getState().loadTags()])
        useWatcherStore.getState().refreshChangedFileIds()
      }
    } else {
      setError(result.error || 'Error')
    }
  }

  if (!config) return null

  const issues = report ? [...report.errors, ...report.conflicts, ...report.deletedRemotely] : []

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('sync.label')}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{t('sync.description')}</p>

      <div className="grid gap-3 sm:grid-cols-[1fr_200px] mb-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('sync.remoteUrl')}
          </label>
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="git@github.com:user/sge-data.git"
            spellCheck={false}
            autoComplete="off"
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('sync.machineName')}
          </label>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">{t('sync.remoteHint')}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={save}
          disabled={!dirty || busy !== null}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-secondary rounded-lg hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {t('sync.save')}
        </button>
        <button
          onClick={test}
          disabled={!urlDraft.trim() || busy !== null}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-secondary rounded-lg hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <PlugZap className="w-3.5 h-3.5" />
          {busy === 'test' ? t('sync.working') : t('sync.test')}
        </button>
        <button
          onClick={() => run('push')}
          disabled={!urlDraft.trim() || busy !== null}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <CloudUpload className="w-3.5 h-3.5" />
          {busy === 'push' ? t('sync.working') : t('sync.push')}
        </button>
        <button
          onClick={() => run('pull')}
          disabled={!urlDraft.trim() || busy !== null}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <CloudDownload className="w-3.5 h-3.5" />
          {busy === 'pull' ? t('sync.working') : t('sync.pull')}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t('sync.lastPush')}: {formatDate(config.lastPushAt)} · {t('sync.lastPull')}:{' '}
        {formatDate(config.lastPullAt)}
      </p>

      {notice && <p className="text-xs text-success mt-2">{notice}</p>}
      {error && (
        <div className="flex items-start gap-2 p-2.5 mt-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {report && (
        <div className="mt-3 p-3 bg-secondary/50 border border-border rounded-lg text-xs space-y-1.5">
          <p className="font-medium">
            {report.direction === 'push'
              ? t('sync.pushSummary', { pushed: report.pushed, upToDate: report.upToDate })
              : t('sync.pullSummary', {
                  created: report.created,
                  updated: report.updated,
                  fastForwarded: report.fastForwarded
                })}
          </p>
          {issues.length === 0 ? (
            <p className="text-muted-foreground">{t('sync.noIssues')}</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {report.errors.map((i) => (
                <li key={`e-${i.fileId}-${i.detail}`} className="text-destructive break-all">
                  {t('sync.issueError')} · {i.fileName}: {i.detail}
                </li>
              ))}
              {report.conflicts.map((i) => (
                <li key={`c-${i.fileId}-${i.detail}`} className="text-warning break-all">
                  {t('sync.issueConflict')} · {i.fileName}: {i.detail}
                </li>
              ))}
              {report.deletedRemotely.map((i) => (
                <li key={`d-${i.fileId}`} className="text-muted-foreground break-all">
                  {t('sync.issueDeleted', { name: i.fileName })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
