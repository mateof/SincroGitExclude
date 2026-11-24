import { kbHandle } from './kb-handlers'
import { rejectRemote } from './kb-sync-handlers'
import type { SemanticService } from '../kb/semantic/semantic-service'
import type { KbSemanticConfig } from '../../shared/kb/types'

export function registerKbSemanticHandlers(semantic: SemanticService): void {
  kbHandle('kb:semantic-status', () => semantic.status())
  kbHandle('kb:semantic-config', () => semantic.getConfig())
  kbHandle('kb:semantic-set-config', (e, config: KbSemanticConfig) => {
    rejectRemote(e, 'Choosing the embedding model')
    return semantic.setConfig(config)
  })
  kbHandle('kb:semantic-reindex', () => {
    semantic.reindexAll()
    return semantic.status()
  })
}
