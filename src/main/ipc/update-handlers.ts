import { kbHandle } from './kb-handlers'
import { rejectRemote } from './kb-sync-handlers'
import { isWebEvent } from './channel-registry'
import type { UpdateService } from '../update/update-service'

export function registerUpdateHandlers(update: UpdateService): void {
  kbHandle('update:capability', (e) =>
    isWebEvent(e) ? { supported: false, blocker: 'platform' } : update.capability()
  )
  kbHandle('update:state', () => update.current())
  kbHandle('update:download', (e, version: string) => {
    rejectRemote(e, 'Updating the app')
    return update.download(String(version))
  })
  kbHandle('update:cancel', (e) => {
    rejectRemote(e, 'Updating the app')
    return update.cancel()
  })
  kbHandle('update:install', (e) => {
    rejectRemote(e, 'Updating the app')
    return update.install()
  })
}
