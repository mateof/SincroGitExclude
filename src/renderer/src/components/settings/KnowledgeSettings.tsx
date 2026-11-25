import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { kbCall, useKbStore } from '@/stores/kb-store'
import { useUIStore } from '@/stores/ui-store'
import type { KbSemanticConfig } from '../../../../shared/kb/types'

interface ConfigView extends KbSemanticConfig {
  models: Array<{ id: string; label: string; sizeMb: number; dims: number }>
}

const input = 'w-full px-2.5 py-1.5 text-xs bg-secondary border border-border rounded-md outline-none focus:ring-1 focus:ring-primary'

export function KnowledgeSettings() {
  const { t } = useTranslation('kb')
  const isWebMode = useUIStore((s) => s.isWebMode)
  const { semantic, loadSemantic } = useKbStore()
  const [config, setConfig] = useState<ConfigView | null>(null)
  const [draft, setDraft] = useState<KbSemanticConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    kbCall<ConfigView>('kb:semantic-config').then((c) => {
      setConfig(c)
      setDraft({ provider: c.provider, model: c.model, endpoint: c.endpoint, apiKeyEnv: c.apiKeyEnv })
    })
    void loadSemantic()
  }, [loadSemantic])

  if (!config || !draft) return null

  const localModel = config.models.find((m) => m.id === draft.model)
  const changed = JSON.stringify(draft) !== JSON.stringify({ provider: config.provider, model: config.model, endpoint: config.endpoint, apiKeyEnv: config.apiKeyEnv })

  const setProvider = (provider: KbSemanticConfig['provider']): void => {
    const model =
      provider === 'local'
        ? config.models.find((m) => m.id === draft.model)?.id ?? config.models[0].id
        : provider === 'ollama'
          ? 'embeddinggemma'
          : provider === 'openai'
            ? 'text-embedding-3-small'
            : draft.model
    const endpoint = provider === 'ollama' ? draft.endpoint || 'http://127.0.0.1:11434' : provider === 'openai' ? draft.endpoint || '' : undefined
    setDraft({ ...draft, provider, model, endpoint })
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await kbCall('kb:semantic-set-config', draft)
      const c = await kbCall<ConfigView>('kb:semantic-config')
      setConfig(c)
      await loadSemantic()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const statusLine = (): string => {
    if (!semantic || semantic.provider === 'off') return t('settings.off')
    if (semantic.error) return t('settings.error', { error: semantic.error })
    if (semantic.downloadProgress !== null) return t('settings.downloading', { progress: semantic.downloadProgress })
    if (semantic.indexing) return t('settings.indexing', { embedded: semantic.embedded, chunks: semantic.chunks })
    return t('settings.ready', { embedded: semantic.embedded })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t('settings.title')} · {t('settings.semantic')}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.semanticHint')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">{t('settings.provider')}</span>
          <select value={draft.provider} disabled={isWebMode} onChange={(e) => setProvider(e.target.value as KbSemanticConfig['provider'])} className={input}>
            {(['off', 'local', 'ollama', 'openai'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`settings.providers.${p}`)}
              </option>
            ))}
          </select>
        </label>
        {draft.provider !== 'off' && (
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">{t('settings.model')}</span>
            {draft.provider === 'local' ? (
              <select value={draft.model} disabled={isWebMode} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className={input}>
                {config.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} (~{m.sizeMb} MB)
                  </option>
                ))}
              </select>
            ) : (
              <input value={draft.model} disabled={isWebMode} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className={input} />
            )}
          </label>
        )}
        {(draft.provider === 'ollama' || draft.provider === 'openai') && (
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">{t('settings.endpoint')}</span>
            <input value={draft.endpoint ?? ''} disabled={isWebMode} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} className={input} placeholder="http://192.168.0.22:11434" />
          </label>
        )}
        {draft.provider === 'openai' && (
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">{t('settings.apiKeyEnv')}</span>
            <input value={draft.apiKeyEnv ?? ''} disabled={isWebMode} onChange={(e) => setDraft({ ...draft, apiKeyEnv: e.target.value || undefined })} className={`${input} font-mono`} placeholder="OPENAI_API_KEY" />
          </label>
        )}
      </div>
      {draft.provider === 'local' && localModel && <p className="text-[11px] text-muted-foreground">{t('settings.localDownload', { size: localModel.sizeMb })}</p>}
      {(draft.provider === 'ollama' || draft.provider === 'openai') && (
        <p className="text-[11px] text-warning flex gap-1">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
          {t('settings.leavesDevice')}
        </p>
      )}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t('settings.status')}:</span>
        <span className={semantic?.error ? 'text-destructive' : semantic?.ready ? 'text-success' : ''}>{statusLine()}</span>
        {(semantic?.indexing || semantic?.downloadProgress !== null) && semantic?.provider !== 'off' && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
        <div className="ml-auto flex gap-2">
          {config.provider !== 'off' && (
            <button type="button" onClick={() => void kbCall('kb:semantic-reindex').then(loadSemantic)} className="inline-flex items-center gap-1 px-2.5 py-1 border border-border rounded-md hover:bg-secondary">
              <RefreshCw className="w-3 h-3" />
              {t('settings.reindex')}
            </button>
          )}
          {!isWebMode && changed && (
            <button type="button" disabled={busy} onClick={() => void save()} className="px-3 py-1 bg-primary text-primary-foreground rounded-md disabled:opacity-50">
              {t('settings.apply')}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
