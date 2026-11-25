import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/ui-store'
import { clampSidebarWidth, CONTENT_MIN, maxSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MIN, widthForKey } from '@/lib/sidebar-width'

const DRAG_THRESHOLD = 3

interface Drag {
  startX: number
  startWidth: number
  width: number | null
}

export function ResizableAside({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const width = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const aside = useRef<HTMLElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState(window.innerWidth)

  useEffect(() => {
    const onResize = (): void => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const shownWidth = (): number => aside.current?.getBoundingClientRect().width ?? width

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    drag.current = { startX: e.clientX, startWidth: shownWidth(), width: null }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || !aside.current) return
    const moved = e.clientX - current.startX
    if (current.width === null && Math.abs(moved) < DRAG_THRESHOLD) return
    if (current.width === null) setDragging(true)
    current.width = clampSidebarWidth(current.startWidth + moved, window.innerWidth)
    aside.current.style.width = `${current.width}px`
  }

  const onLostPointerCapture = (): void => {
    const final = drag.current?.width
    drag.current = null
    setDragging(false)
    if (final) setSidebarWidth(final)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = widthForKey(e.key, e.shiftKey, shownWidth(), window.innerWidth)
    if (next === null) return
    e.preventDefault()
    setSidebarWidth(next)
  }

  return (
    <aside
      ref={aside}
      id="app-sidebar"
      className="relative border-r border-border flex flex-col bg-card/50 shrink-0"
      style={{ width, maxWidth: `max(${SIDEBAR_MIN}px, calc(100vw - ${CONTENT_MIN}px))` }}
    >
      {children}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-controls="app-sidebar"
        aria-label={t('sidebar.resize')}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={maxSidebarWidth(viewport)}
        aria-valuenow={clampSidebarWidth(width, viewport)}
        title={t('sidebar.resizeHint')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onLostPointerCapture={onLostPointerCapture}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -right-1.5 z-20 w-2 flex justify-center cursor-col-resize touch-none select-none outline-none"
      >
        <span
          className={`w-0.5 h-full transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary ${dragging ? 'bg-primary' : ''}`}
        />
      </div>
    </aside>
  )
}
