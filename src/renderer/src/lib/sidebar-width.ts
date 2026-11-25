export const SIDEBAR_DEFAULT = 256
export const SIDEBAR_MIN = SIDEBAR_DEFAULT
export const CONTENT_MIN = 480

const STORAGE_KEY = 'sidebarWidth'
const STEP = 16
const BIG_STEP = 64

export function maxSidebarWidth(viewport: number): number {
  return Math.max(SIDEBAR_MIN, viewport - CONTENT_MIN)
}

export function clampSidebarWidth(width: number, viewport: number): number {
  return Math.round(Math.min(maxSidebarWidth(viewport), Math.max(SIDEBAR_MIN, width)))
}

export function widthForKey(key: string, shift: boolean, width: number, viewport: number): number | null {
  const step = shift ? BIG_STEP : STEP
  if (key === 'ArrowLeft') return clampSidebarWidth(width - step, viewport)
  if (key === 'ArrowRight') return clampSidebarWidth(width + step, viewport)
  if (key === 'Home') return SIDEBAR_MIN
  if (key === 'End') return maxSidebarWidth(viewport)
  return null
}

export function parseSidebarWidth(stored: string | null): number {
  const width = Number(stored)
  return stored && Number.isFinite(width) && width >= SIDEBAR_MIN ? Math.round(width) : SIDEBAR_DEFAULT
}

export function readSidebarWidth(): number {
  try {
    return parseSidebarWidth(localStorage.getItem(STORAGE_KEY))
  } catch {
    return SIDEBAR_DEFAULT
  }
}

export function storeSidebarWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    return
  }
}
