import { ipcMain } from 'electron'
import { describeError } from '../utils/errors'
import { pushEvent } from '../events'
import { readPreferences, writePreferences, type Preferences } from '../preferences'

export function registerPreferencesHandlers(apply: (preferences: Preferences) => void): void {
  const update = (patch: Partial<Preferences>): Preferences => {
    const next = writePreferences(patch)
    apply(next)
    pushEvent('preferences:changed', next)
    return next
  }

  ipcMain.handle('preferences:get', async () => {
    try {
      return { success: true, data: readPreferences() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('preferences:set', async (_, patch: Partial<Preferences>) => {
    try {
      return { success: true, data: update(patch) }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('preferences:migrate', async (_, legacy: Partial<Preferences>) => {
    try {
      const current = readPreferences()
      if (current.migrated) return { success: true, data: current.preferences }
      return { success: true, data: update(legacy) }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })
}
