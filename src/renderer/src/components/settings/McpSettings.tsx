import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Play,
  Square,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  Terminal,
  FileJson
} from 'lucide-react'
import type { IpcResult } from '@/types'
import { copyText } from '@/lib/clipboard'
import { McpTokens, type McpTokenView } from './McpTokens'

type Shell = 'bash' | 'powershell' | 'cmd'

interface McpState {
  enabled: boolean
  port: number
  bindAll: boolean
  readOnly: boolean
  preventSleep: boolean
  token: string
  tokens: McpTokenView[]
  defaultPort: number
  platform: string
  running: boolean
  urls: string[]
}

interface ClientSnippet {
  id: string
  label: string
  kind: 'command' | 'config'
  path?: string
  note?: 'merge' | 'nodeRequired' | 'antigravity'
  content: string
}

const SHELLS: Array<{ id: Shell; label: string }> = [
  { id: 'bash', label: 'bash / zsh' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'cmd', label: 'cmd' }
]

export function McpSettings() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<McpState | null>(null)
  const [portDraft, setPortDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [shell, setShell] = useState<Shell>('bash')
  const [clients, setClients] = useState<ClientSnippet[]>([])
  const [clientId, setClientId] = useState('claude-code')
  const [tokenId, setTokenId] = useState<string | null>(null)

  const apply = useCallback((result: IpcResult<McpState>) => {
    if (result?.success && result.data) {
      const data = result.data
      setState(data)
      setPortDraft(String(data.port))
      setUrl((current) => (current && data.urls.includes(current) ? current : data.urls[0]))
      setError(null)
    } else {
      setError(result?.error || 'Error')
    }
  }, [])

  useEffect(() => {
    window.api.invoke<IpcResult<McpState>>('mcp:get-state').then((result) => {
      apply(result)
      if (result.success && result.data?.platform === 'win32') setShell('powershell')
    })
  }, [apply])

  useEffect(() => {
    if (!url || !state) return
    window.api.invoke<IpcResult<ClientSnippet[]>>('mcp:clients', url, shell, tokenId ?? undefined).then((result) => {
      if (result.success && result.data) setClients(result.data)
    })
  }, [url, shell, state?.token, tokenId])

  const run = async (channel: string, ...args: unknown[]) => {
    setBusy(true)
    apply(await window.api.invoke<IpcResult<McpState>>(channel, ...args))
    setBusy(false)
  }

  const copy = async (text: string, key: string) => {
    if (await copyText(text)) {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    }
  }

  if (!state) return null

  const selected = clients.find((c) => c.id === clientId) ?? clients[0]
  const portValue = Number(portDraft)
  const portValid = Number.isInteger(portValue) && portValue > 0 && portValue < 65536

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('mcp.label')}</h3>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] ${
            state.running ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${state.running ? 'bg-success' : 'bg-muted-foreground'}`} />
          {state.running ? t('mcp.running') : t('mcp.stopped')}
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-3">{t('mcp.description')}</p>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <button
          onClick={() => run(state.running ? 'mcp:stop' : 'mcp:start')}
          disabled={busy}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 ${
            state.running ? 'bg-secondary hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {state.running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {state.running ? t('mcp.stop') : t('mcp.start')}
        </button>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('mcp.port')}</label>
          <div className="flex items-center gap-1.5">
            <input
              value={portDraft}
              onChange={(e) => setPortDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && portValid) run('mcp:set-config', { port: portValue })
              }}
              className="w-24 px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary"
            />
            {portDraft !== String(state.port) && (
              <button
                onClick={() => run('mcp:set-config', { port: portValue })}
                disabled={!portValid || busy}
                className="px-2.5 py-1.5 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-40"
              >
                {t('mcp.apply')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={state.readOnly}
            disabled={busy}
            onChange={(e) => run('mcp:set-config', { readOnly: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            {t('mcp.readOnly')}
            <span className="block text-[11px] text-muted-foreground">{t('mcp.readOnlyHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={state.bindAll}
            disabled={busy}
            onChange={(e) => run('mcp:set-config', { bindAll: e.target.checked })}
            className="mt-0.5"
          />
          <span>{t('mcp.bindAll')}</span>
        </label>
        {state.bindAll && (
          <div className="flex items-start gap-2 p-2.5 bg-warning/10 border border-warning/30 rounded-lg text-[11px] text-warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t('mcp.networkWarning')}</span>
          </div>
        )}
        {state.bindAll && (
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={state.preventSleep}
              disabled={busy}
              onChange={(e) => run('mcp:set-config', { preventSleep: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              {t('mcp.preventSleep')}
              <span className="block text-[11px] text-muted-foreground">{t('mcp.preventSleepHint')}</span>
            </span>
          </label>
        )}
      </div>

      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('mcp.token')}</label>
        <div className="flex items-center gap-1.5">
          <input
            readOnly
            type={showToken ? 'text' : 'password'}
            value={state.token}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-secondary border border-border rounded-md outline-none"
          />
          <button
            onClick={() => setShowToken((v) => !v)}
            className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
            title={showToken ? t('mcp.hideToken') : t('mcp.showToken')}
          >
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => copy(state.token, 'token')}
            className="p-1.5 border border-border rounded-md hover:bg-secondary transition-colors"
            title={t('mcp.copy')}
          >
            {copied === 'token' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => {
              if (window.confirm(t('mcp.regenerateConfirm'))) run('mcp:regenerate-token')
            }}
            disabled={busy}
            className="p-1.5 border border-border rounded-md hover:bg-secondary disabled:opacity-40 transition-colors"
            title={t('mcp.regenerate')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <McpTokens
        tokens={state.tokens ?? []}
        selected={tokenId}
        onSelect={setTokenId}
        onChanged={() => void window.api.invoke<IpcResult<McpState>>('mcp:get-state').then(apply)}
      />

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold mb-1">{t('mcp.connectTitle')}</h4>
        <p className="text-[11px] text-muted-foreground mb-2.5">{t('mcp.connectHint')}</p>

        <div className="flex flex-wrap gap-2 mb-2.5">
          {state.urls.length > 1 && (
            <select
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="px-2 py-1 text-xs font-mono bg-secondary border border-border rounded-md outline-none"
            >
              {state.urls.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {SHELLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setShell(s.id)}
                className={`px-2.5 py-1 text-[11px] transition-colors ${
                  shell === s.id ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setClientId(c.id)}
              className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                selected?.id === c.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-secondary'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {selected && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
              {selected.kind === 'command' ? <Terminal className="w-3 h-3" /> : <FileJson className="w-3 h-3" />}
              {selected.kind === 'command'
                ? t('mcp.runInTerminal')
                : selected.path
                  ? t('mcp.addToFile', { path: selected.path })
                  : t('mcp.genericConfig')}
            </div>
            <div className="relative">
              <pre className="p-3 pr-10 text-[11px] font-mono bg-secondary border border-border rounded-lg whitespace-pre-wrap [overflow-wrap:anywhere] max-h-64 overflow-y-auto">
                {selected.content}
              </pre>
              <button
                onClick={() => copy(selected.content, selected.id)}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-card border border-border hover:bg-secondary transition-colors"
                title={t('mcp.copy')}
              >
                {copied === selected.id ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            {selected.note && (
              <p className="text-[11px] text-muted-foreground mt-1.5">{t(`mcp.notes.${selected.note}`)}</p>
            )}
            {!state.running && <p className="text-[11px] text-warning mt-1.5">{t('mcp.notRunningHint')}</p>}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2.5 mt-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  )
}
