import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Plus, Trash2, Copy, Check } from 'lucide-react'
import type { IpcResult } from '@/types'
import { copyText } from '@/lib/clipboard'

export interface McpTokenView {
  id: string
  name: string
  scopes: string[]
  spaces: string[] | null
  createdAt: string
  preview: string
}

const SCOPES = ['kb:read', 'kb:write', 'kb:admin', 'sge:read', 'sge:write']

export function McpTokens({
  tokens,
  selected,
  onSelect,
  onChanged
}: {
  tokens: McpTokenView[]
  selected: string | null
  onSelect: (id: string | null) => void
  onChanged: () => void
}) {
  const { t } = useTranslation('settings')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['kb:read', 'kb:write'])
  const [created, setCreated] = useState<{ id: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    setError(null)
    const result = await window.api.invoke<IpcResult<{ id: string; token: string }>>('mcp:create-token', { name, scopes })
    if (!result.success || !result.data) {
      setError(result.error || 'Error')
      return
    }
    setCreated({ id: result.data.id, token: result.data.token })
    setAdding(false)
    setName('')
    onChanged()
    onSelect(result.data.id)
  }

  const revoke = async (id: string): Promise<void> => {
    if (!window.confirm(t('mcp.tokens.revokeConfirm'))) return
    await window.api.invoke('mcp:revoke-token', id)
    if (selected === id) onSelect(null)
    onChanged()
  }

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2">
        <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
        <h4 className="text-xs font-semibold">{t('mcp.tokens.title')}</h4>
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-border rounded-md hover:bg-secondary"
        >
          <Plus className="w-3 h-3" />
          {t('mcp.tokens.add')}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('mcp.tokens.hint')}</p>
      {adding && (
        <div className="p-2.5 border border-border rounded-lg space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('mcp.tokens.namePlaceholder')}
            className="w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none"
          />
          <div className="flex flex-wrap gap-3">
            {SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope))}
                />
                <span className="font-mono">{scope}</span>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">{t('mcp.tokens.scopesHint')}</p>
          <button
            type="button"
            disabled={!name.trim() || scopes.length === 0}
            onClick={() => void create()}
            className="px-2.5 py-1.5 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-40"
          >
            {t('mcp.tokens.create')}
          </button>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
      {created && (
        <div className="p-2.5 bg-success/10 border border-success/30 rounded-lg space-y-1.5 text-[11px]">
          <div>{t('mcp.tokens.created')}</div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate font-mono select-text">{created.token}</code>
            <button
              type="button"
              className="p-1 border border-border rounded-md"
              onClick={async () => {
                if (await copyText(created.token)) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }
              }}
            >
              {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
      )}
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-[11px] cursor-pointer">
          <input type="radio" checked={selected === null} onChange={() => onSelect(null)} />
          <span className="font-medium">{t('mcp.tokens.primary')}</span>
          <span className="text-muted-foreground">{t('mcp.tokens.allScopes')}</span>
        </label>
        {tokens.map((token) => (
          <div key={token.id} className="flex items-center gap-2 text-[11px]">
            <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
              <input type="radio" checked={selected === token.id} onChange={() => onSelect(token.id)} />
              <span className="font-medium truncate">{token.name}</span>
              <span className="font-mono text-muted-foreground truncate">{token.scopes.join(' ')}</span>
              <span className="font-mono text-muted-foreground/70">{token.preview}</span>
            </label>
            <button type="button" onClick={() => void revoke(token.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive" title={t('mcp.tokens.revoke')}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
