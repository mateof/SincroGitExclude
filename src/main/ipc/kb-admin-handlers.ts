import { kbHandle } from './kb-handlers'
import type { KbAdminService } from '../kb/kb-admin-service'
import type { SpaceSettings } from '../kb/space-admin'

function onlyAssistants(event: unknown): void {
  if ((event as { __transport?: string } | null)?.__transport !== 'mcp') throw new Error('Use the space settings of the app')
}

export function registerKbAdminHandlers(admin: KbAdminService): void {
  kbHandle('kb:assistant-add-space', (e, input: SpaceSettings & { path: string; createFolder?: boolean }, tokenName: string) => {
    onlyAssistants(e)
    return admin.add(input, tokenName)
  })
  kbHandle('kb:assistant-clone-space', (e, input: SpaceSettings & { path: string; remoteUrl: string }, tokenName: string) => {
    onlyAssistants(e)
    return admin.clone(input, tokenName)
  })
  kbHandle('kb:assistant-update-space', (e, spaceId: string, settings: SpaceSettings, tokenName: string) => {
    onlyAssistants(e)
    return admin.update(spaceId, settings, tokenName)
  })
}
