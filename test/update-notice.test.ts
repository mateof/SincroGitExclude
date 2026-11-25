import { describe, it, expect } from 'vitest'
import {
  CHECK_EVERY_MS,
  dismiss,
  initialChannel,
  isCheckDue,
  parseNotice,
  RETRY_AFTER_ERROR_MS,
  shouldNotify,
  snooze,
  SNOOZE_MS
} from '../src/shared/update-notice'

const NOW = Date.UTC(2026, 10, 25, 12)
const CURRENT = '1.21.0-dev.7'
const none = parseNotice(null)

describe('notice of a new version', () => {
  it('appears only for versions newer than the installed one', () => {
    expect(shouldNotify(CURRENT, 'v1.21.0-dev.8', none, NOW)).toBe(true)
    expect(shouldNotify(CURRENT, 'v1.21.0', none, NOW)).toBe(true)
    expect(shouldNotify(CURRENT, 'v1.21.0-dev.7', none, NOW)).toBe(false)
    expect(shouldNotify(CURRENT, 'v1.21.0-dev.6', none, NOW)).toBe(false)
    expect(shouldNotify(CURRENT, 'nightly', none, NOW)).toBe(false)
  })

  it('stays quiet while postponed, also for a version published meanwhile', () => {
    const notice = snooze(none, NOW)
    expect(shouldNotify(CURRENT, '1.21.0-dev.8', notice, NOW + SNOOZE_MS - 1)).toBe(false)
    expect(shouldNotify(CURRENT, '1.21.0-dev.9', notice, NOW + 1)).toBe(false)
  })

  it('comes back when the time is over', () => {
    expect(shouldNotify(CURRENT, '1.21.0-dev.8', snooze(none, NOW), NOW + SNOOZE_MS)).toBe(true)
  })

  it('is not silenced forever when the clock of the computer goes back', () => {
    expect(shouldNotify(CURRENT, '1.21.0-dev.8', snooze(none, NOW), NOW - SNOOZE_MS * 30)).toBe(true)
  })

  it('never comes back for a discarded version, but does for the next one', () => {
    const notice = dismiss(none, 'v1.21.0-dev.8')
    expect(shouldNotify(CURRENT, '1.21.0-dev.8', notice, NOW + SNOOZE_MS * 365)).toBe(false)
    expect(shouldNotify(CURRENT, 'v1.21.0-dev.8', notice, NOW)).toBe(false)
    expect(shouldNotify(CURRENT, 'v1.21.0-dev.9', notice, NOW)).toBe(true)
  })

  it('does not discard a stable version because a higher development one was discarded', () => {
    expect(shouldNotify(CURRENT, '1.21.0', dismiss(none, '1.22.0-dev.1'), NOW)).toBe(true)
  })

  it('remembers several discarded versions without growing forever', () => {
    let notice = none
    for (let i = 8; i < 60; i++) notice = dismiss(notice, `1.21.0-dev.${i}`)
    notice = dismiss(notice, '1.21.0-dev.59')
    expect(notice.dismissed).toHaveLength(20)
    expect(notice.dismissed.filter((v) => v === '1.21.0-dev.59')).toHaveLength(1)
    expect(notice.dismissed).toContain('1.21.0-dev.58')
  })

  it('keeps what was discarded when postponing, and the other way round', () => {
    const notice = snooze(dismiss(none, '1.21.0-dev.8'), NOW)
    expect(notice).toEqual({ dismissed: ['1.21.0-dev.8'], snoozedUntil: NOW + SNOOZE_MS })
    expect(dismiss(notice, '1.21.0-dev.9').snoozedUntil).toBe(NOW + SNOOZE_MS)
  })

  it('survives saved data that is not valid', () => {
    for (const saved of ['', 'null', '[]', '{', '{"dismissed":"x","snoozedUntil":"y"}', '{"snoozedUntil":null}']) {
      expect(parseNotice(saved)).toEqual({ dismissed: [], snoozedUntil: null })
    }
    expect(parseNotice('{"dismissed":["1.0.0",3],"snoozedUntil":5}')).toEqual({ dismissed: ['1.0.0'], snoozedUntil: 5 })
  })
})

describe('background check for updates', () => {
  it('runs at the start and then every two hours', () => {
    expect(isCheckDue(null, NOW)).toBe(true)
    expect(isCheckDue({ at: NOW, ok: true }, NOW + CHECK_EVERY_MS - 1)).toBe(false)
    expect(isCheckDue({ at: NOW, ok: true }, NOW + CHECK_EVERY_MS)).toBe(true)
  })

  it('tries again sooner after a failure, but not at once', () => {
    expect(isCheckDue({ at: NOW, ok: false }, NOW + RETRY_AFTER_ERROR_MS - 1)).toBe(false)
    expect(isCheckDue({ at: NOW, ok: false }, NOW + RETRY_AFTER_ERROR_MS)).toBe(true)
  })

  it('does not wait for hours when the clock of the computer goes back', () => {
    expect(isCheckDue({ at: NOW, ok: true }, NOW - 1)).toBe(true)
  })

  it('follows the channel of the installed build until another one is chosen', () => {
    expect(initialChannel(null, '1.21.0-dev.7')).toBe('dev')
    expect(initialChannel(null, '1.21.0')).toBe('stable')
    expect(initialChannel('beta', '1.21.0-dev.7')).toBe('beta')
    expect(initialChannel('nightly', '1.21.0-beta.1')).toBe('beta')
  })
})
