import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe2,
  Play,
  Square,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  Users,
  Save,
  X
} from 'lucide-react'
import type { IpcResult } from '@/types'
import { useUIStore } from '@/stores/ui-store'
import { copyText } from '@/lib/clipboard'

const MIN_TOKEN_LENGTH = 8
const MAX_TOKEN_LENGTH = 128

interface ServerState {
  enabled: boolean
  port: number
  bindAll: boolean
  token: string
  defaultPort: number
  running: boolean
  urls: string[]
  clients: number
}

export function WebServerSettings() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { isWebMode } = useUIStore()

  const [state, setState] = useState<ServerState | null>(null)
  const [portDraft, setPortDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // null while the field mirrors the saved token; a string once the user edits
  // it, so the 5s poll cannot overwrite what is being typed
  const [tokenDraft, setTokenDraft] = useState<string | null>(null)

  const apply = useCallback((result: IpcResult<ServerState>) => {
    if (result?.success && result.data) {
      setState(result.data)
      setPortDraft(String(result.data.port))
      setError(null)
    } else {
      setError(result?.error || 'Error')
    }
  }, [])

  const load = useCallback(async () => {
    apply(await window.api.invoke<IpcResult<ServerState>>('server:get-state'))
  }, [apply])

  useEffect(() => {
    load()
    // Client count only changes on the server side, so poll while this page is open
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  const run = async (channel: string, ...args: unknown[]): Promise<void> => {
    setBusy(true)
    apply(await window.api.invoke<IpcResult<ServerState>>(channel, ...args))
    setBusy(false)
  }

  const copy = async (value: string, key: string): Promise<void> => {
    if (!(await copyText(value))) {
      setError(t('webServer.copyError'))
      return
    }
    setError(null)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const saveToken = async (): Promise<void> => {
    if (tokenDraft === null || !state || tokenDraft === state.token) return
    const token = tokenDraft.trim()
    if (
      token.length < MIN_TOKEN_LENGTH ||
      token.length > MAX_TOKEN_LENGTH ||
      /\s/.test(token)
    ) {
      setError(t('webServer.tokenInvalid', { min: MIN_TOKEN_LENGTH, max: MAX_TOKEN_LENGTH }))
      return
    }
    setBusy(true)
    const result = await window.api.invoke<IpcResult<ServerState>>('server:set-token', token)
    apply(result)
    setBusy(false)
    // Keep the draft on the screen when the save was rejected, so the value is
    // not lost and the error explains itself
    if (result?.success) setTokenDraft(null)
  }

  const commitPort = async (): Promise<void> => {
    const port = Number(portDraft)
    if (!state || port === state.port) return
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortDraft(String(state.port))
      setError(t('webServer.invalidPort'))
      return
    }
    await run('server:set-config', { port })
  }

  if (!state) return null

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('webServer.label')}</h3>
        </div>
        <div className="flex items-center gap-2">
          {state.running && (
            <span className="inline-flex items-center gap-1 text-[11px] text-success">
              <Users className="w-3 h-3" />
              {t('webServer.clients', { count: state.clients })}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] ${
              state.running
                ? 'bg-success/15 text-success'
                : 'bg-secondary text-muted-foreground'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                state.running ? 'bg-success' : 'bg-muted-foreground'
              }`}
            />
            {state.running ? t('webServer.running') : t('webServer.stopped')}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">{t('webServer.description')}</p>

      {isWebMode && (
        <div className="flex items-start gap-2 p-3 mb-3 bg-secondary border border-border rounded-lg text-xs text-muted-foreground">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('webServer.desktopOnly')}</span>
        </div>
      )}

      {state.running && state.urls.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {state.urls.map((url) => (
            <div key={url} className="flex items-center gap-2">
              <span className="text-xs font-mono truncate flex-1">{url}</span>
              <button
                onClick={() => copy(url, url)}
                className="p-1 rounded hover:bg-secondary transition-colors shrink-0"
                title={t('webServer.copyUrl')}
              >
                {copied === url ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Access token */}
      <div className="mb-3">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          {t('webServer.token')}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type={showToken ? 'text' : 'password'}
            value={tokenDraft ?? state.token}
            disabled={busy || isWebMode}
            spellCheck={false}
            autoComplete="off"
            maxLength={MAX_TOKEN_LENGTH}
            onChange={(e) => setTokenDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveToken()
              if (e.key === 'Escape') setTokenDraft(null)
            }}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          {tokenDraft !== null && tokenDraft !== state.token ? (
            <>
              <button
                onClick={saveToken}
                disabled={busy}
                className="p-1.5 border border-border rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                title={t('webServer.saveToken')}
              >
                <Save className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setTokenDraft(null)
                  setError(null)
                }}
                className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
                title={t('webServer.cancelToken')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : null}
          <button
            onClick={() => setShowToken((v) => !v)}
            className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
            title={showToken ? t('webServer.hideToken') : t('webServer.showToken')}
          >
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => copy(state.token, 'token')}
            className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
            title={t('webServer.copyToken')}
          >
            {copied === 'token' ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => {
              setTokenDraft(null)
              run('server:regenerate-token')
            }}
            disabled={busy || isWebMode}
            className="p-1.5 border border-border rounded-md hover:bg-secondary disabled:opacity-40 transition-colors"
            title={t('webServer.regenerate')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">{t('webServer.tokenHint', { min: MIN_TOKEN_LENGTH })}</p>
      </div>

      {/* Port + bind */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('webServer.port')}
          </label>
          <input
            type="number"
            min={1}
            max={65535}
            value={portDraft}
            disabled={busy || isWebMode}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={commitPort}
            className="w-28 px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <label className="flex items-center gap-2 text-xs pb-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={state.bindAll}
            disabled={busy || isWebMode}
            onChange={(e) => run('server:set-config', { bindAll: e.target.checked })}
            className="rounded border-border"
          />
          {t('webServer.bindAll')}
        </label>
      </div>

      {state.bindAll && (
        <div className="flex items-start gap-2 p-3 mb-3 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('webServer.networkWarning')}</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2.5 py-1.5 mb-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {state.running ? (
          <button
            onClick={() => run('server:stop')}
            disabled={busy || isWebMode}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            {t('webServer.stop')}
          </button>
        ) : (
          <button
            onClick={() => run('server:start')}
            disabled={busy || isWebMode}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            {t('webServer.start')}
          </button>
        )}
        <button
          onClick={load}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-secondary rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {tc('actions.refresh')}
        </button>
      </div>
    </div>
  )
}
