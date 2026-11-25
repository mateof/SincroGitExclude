import { describe, it, expect } from 'vitest'
import {
  clampSidebarWidth,
  CONTENT_MIN,
  maxSidebarWidth,
  parseSidebarWidth,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  widthForKey
} from '../src/renderer/src/lib/sidebar-width'

describe('width of the sidebar', () => {
  it('can take everything on a big screen except the room the content needs', () => {
    expect(clampSidebarWidth(5000, 2560)).toBe(2560 - CONTENT_MIN)
    expect(clampSidebarWidth(700.4, 2560)).toBe(700)
  })

  it('never gets narrower than its controls', () => {
    expect(clampSidebarWidth(10, 2560)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(-300, 2560)).toBe(SIDEBAR_MIN)
  })

  it('keeps its minimum on a window too small for both', () => {
    expect(maxSidebarWidth(390)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(600, 390)).toBe(SIDEBAR_MIN)
  })

  it('moves with the keyboard inside the same limits', () => {
    expect(widthForKey('ArrowRight', false, 300, 1600)).toBe(316)
    expect(widthForKey('ArrowLeft', false, 300, 1600)).toBe(284)
    expect(widthForKey('ArrowRight', true, 300, 1600)).toBe(364)
    expect(widthForKey('ArrowLeft', true, 230, 1600)).toBe(SIDEBAR_MIN)
    expect(widthForKey('Home', false, 300, 1600)).toBe(SIDEBAR_MIN)
    expect(widthForKey('End', false, 300, 1600)).toBe(1600 - CONTENT_MIN)
    expect(widthForKey('Tab', false, 300, 1600)).toBeNull()
  })

  it('starts at the usual width when nothing valid was saved', () => {
    for (const saved of [null, '', 'ancho', 'NaN', 'Infinity', '0', '-50', '12']) {
      expect(parseSidebarWidth(saved)).toBe(SIDEBAR_DEFAULT)
    }
  })

  it('remembers a width bigger than the current window for when it grows back', () => {
    expect(parseSidebarWidth('900')).toBe(900)
  })
})
