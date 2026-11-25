import { create } from 'zustand'
import { useUIStore } from './ui-store'
import { compareVersions, pickRelease, type Channel } from '../../../shared/update-channels'
import { dismiss, initialChannel, parseNotice, snooze, type UpdateNoticeState } from '../../../shared/update-notice'
import type { UpdateCapability, UpdateState } from '../../../shared/update-types'

const RELEASES_WITH_PRERELEASES_URL = 'https://api.github.com/repos/mateof/SincroGitExclude/releases?per_page=30'
const NOTICE_KEY = 'updateNotice'

interface Reply<T> {
  success: boolean
  data?: T
  error?: string
}

export interface ReleaseInfo {
  tag_name: string
  html_url: string
  draft?: boolean
  published_at?: string
}

interface UpdateStore {
  currentVersion: string | null
  channel: Channel
  releases: ReleaseInfo[] | null
  checking: boolean
  lastCheck: { at: number; ok: boolean } | null
  capability: UpdateCapability | null
  progress: UpdateState | null
  actionError: string | null
  notice: UpdateNoticeState
  reveal: boolean
  init: () => Promise<void>
  check: () => Promise<void>
  setChannel: (channel: Channel) => void
  run: (action: 'download' | 'cancel' | 'install', version?: string) => Promise<void>
  startUpdate: (version: string) => void
  snoozeNotice: () => void
  dismissVersion: (version: string) => void
  clearReveal: () => void
}

let started: Promise<void> | null = null

function saveNotice(notice: UpdateNoticeState): UpdateNoticeState {
  localStorage.setItem(NOTICE_KEY, JSON.stringify(notice))
  return notice
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  currentVersion: null,
  channel: 'stable',
  releases: null,
  checking: false,
  lastCheck: null,
  capability: null,
  progress: null,
  actionError: null,
  notice: parseNotice(localStorage.getItem(NOTICE_KEY)),
  reveal: false,

  init: () => {
    started ??= (async () => {
      window.api.on('update:state', (state) => set({ progress: state as UpdateState }))
      const [paths, capability, progress] = await Promise.all([
        window.api.invoke<Reply<{ appVersion: string }>>('app:get-paths'),
        window.api.invoke<Reply<UpdateCapability>>('update:capability'),
        window.api.invoke<Reply<UpdateState>>('update:state')
      ])
      const currentVersion = paths.data?.appVersion ?? null
      set({
        currentVersion,
        channel: initialChannel(localStorage.getItem('updateChannel'), currentVersion ?? ''),
        capability: capability.data ?? null,
        progress: progress.data ?? null
      })
    })().catch((error: unknown) => {
      started = null
      throw error
    })
    return started
  },

  check: async () => {
    if (get().checking) return
    set({ checking: true })
    try {
      const res = await fetch(RELEASES_WITH_PRERELEASES_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      set({ releases: (await res.json()) as ReleaseInfo[], lastCheck: { at: Date.now(), ok: true } })
    } catch {
      set({ lastCheck: { at: Date.now(), ok: false } })
    } finally {
      set({ checking: false })
    }
  },

  setChannel: (channel) => {
    if (channel === get().channel) return
    localStorage.setItem('updateChannel', channel)
    set({ channel })
    void get().check()
  },

  run: async (action, version) => {
    set({ actionError: null })
    const reply = await window.api.invoke<Reply<UpdateState>>(`update:${action}`, ...(version ? [version] : []))
    if (!reply.success) set({ actionError: reply.error ?? '' })
  },

  startUpdate: (version) => {
    set({ reveal: true })
    useUIStore.getState().setCurrentView('settings')
    if (get().capability?.supported) void get().run('download', version.replace(/^v/, ''))
  },

  snoozeNotice: () => set((s) => ({ notice: saveNotice(snooze(s.notice, Date.now())) })),

  dismissVersion: (version) => set((s) => ({ notice: saveNotice(dismiss(s.notice, version)) })),

  clearReveal: () => set({ reveal: false })
}))

export function availableUpdate(state: Pick<UpdateStore, 'releases' | 'channel' | 'currentVersion'>): ReleaseInfo | null {
  if (!state.releases || !state.currentVersion) return null
  const newest = pickRelease(state.releases, state.channel)
  return newest && compareVersions(state.currentVersion, newest.tag_name) < 0 ? newest : null
}
