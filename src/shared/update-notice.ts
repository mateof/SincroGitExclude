import { channelOf, compareVersions, isChannel, type Channel } from './update-channels'

const MINUTE = 60_000
export const SNOOZE_MS = 24 * 60 * MINUTE
export const CHECK_EVERY_MS = 2 * 60 * MINUTE
export const RETRY_AFTER_ERROR_MS = 15 * MINUTE
const DISMISSED_LIMIT = 20

export interface UpdateNoticeState {
  dismissed: string[]
  snoozedUntil: number | null
}

const EMPTY: UpdateNoticeState = { dismissed: [], snoozedUntil: null }

function normalize(version: string): string {
  return version.trim().replace(/^v/, '')
}

export function initialChannel(stored: string | null, currentVersion: string): Channel {
  return isChannel(stored) ? stored : channelOf(currentVersion)
}

export function parseNotice(stored: string | null): UpdateNoticeState {
  if (!stored) return EMPTY
  try {
    const { dismissed, snoozedUntil } = JSON.parse(stored) as Partial<UpdateNoticeState>
    return {
      dismissed: Array.isArray(dismissed) ? dismissed.filter((v): v is string => typeof v === 'string') : [],
      snoozedUntil: typeof snoozedUntil === 'number' && Number.isFinite(snoozedUntil) ? snoozedUntil : null
    }
  } catch {
    return EMPTY
  }
}

export function snooze(notice: UpdateNoticeState, now: number): UpdateNoticeState {
  return { ...notice, snoozedUntil: now + SNOOZE_MS }
}

export function dismiss(notice: UpdateNoticeState, version: string): UpdateNoticeState {
  const name = normalize(version)
  return { ...notice, dismissed: [...notice.dismissed.filter((v) => v !== name), name].slice(-DISMISSED_LIMIT) }
}

export function shouldNotify(current: string, latest: string, notice: UpdateNoticeState, now: number): boolean {
  if (compareVersions(current, latest) >= 0) return false
  if (notice.dismissed.includes(normalize(latest))) return false
  const { snoozedUntil } = notice
  const clockWentBack = snoozedUntil !== null && snoozedUntil - now > SNOOZE_MS
  return snoozedUntil === null || clockWentBack || now >= snoozedUntil
}

export function isCheckDue(last: { at: number; ok: boolean } | null, now: number): boolean {
  if (!last || now < last.at) return true
  return now - last.at >= (last.ok ? CHECK_EVERY_MS : RETRY_AFTER_ERROR_MS)
}
