import { create } from 'zustand'
import type { IpcResult } from '@/types'

export interface Preferences {
  autoExclude: boolean
  snapshotsEnabled: boolean
  verboseLogs: boolean
}

interface PreferencesStore {
  preferences: Preferences
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Preferences>) => Promise<boolean>
  receive: (preferences: Preferences) => void
}

const legacy = (): Partial<Preferences> => {
  try {
    const read = (key: string) => localStorage.getItem(key)
    const patch: Partial<Preferences> = {}
    if (read('autoExclude') !== null) patch.autoExclude = read('autoExclude') !== 'false'
    if (read('snapshotsEnabled') !== null) patch.snapshotsEnabled = read('snapshotsEnabled') !== 'false'
    if (read('logVerbose') !== null) patch.verboseLogs = read('logVerbose') === 'true'
    return patch
  } catch {
    return {}
  }
}

export const usePreferencesStore = create<PreferencesStore>((set) => ({
  preferences: { autoExclude: true, snapshotsEnabled: true, verboseLogs: false },
  loaded: false,

  load: async () => {
    const result = await window.api.invoke<IpcResult<{ preferences: Preferences; migrated: boolean }>>(
      'preferences:get'
    )
    if (!result.success || !result.data) return
    if (result.data.migrated) {
      set({ preferences: result.data.preferences, loaded: true })
      return
    }
    const migrated = await window.api.invoke<IpcResult<Preferences>>('preferences:migrate', legacy())
    set({
      preferences: migrated.success && migrated.data ? migrated.data : result.data.preferences,
      loaded: true
    })
  },

  update: async (patch) => {
    const result = await window.api.invoke<IpcResult<Preferences>>('preferences:set', patch)
    if (result.success && result.data) {
      set({ preferences: result.data })
      return true
    }
    return false
  },

  receive: (preferences) => set({ preferences, loaded: true })
}))
