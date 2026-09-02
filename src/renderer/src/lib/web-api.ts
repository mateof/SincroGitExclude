/**
 * Browser transport for `window.api`.
 *
 * When the renderer runs inside Electron the preload script has already put a
 * real `window.api` in place and this module does nothing. When it is served
 * over HTTP there is no preload, so the same surface is rebuilt on top of
 * fetch + WebSocket. Every call site keeps using `window.api.invoke` unchanged.
 *
 * Must be imported before anything touches `window.api` — see `main.tsx`.
 */
import { requestPick } from './remote-picker-bridge'

export const isWebMode = typeof window !== 'undefined' && !window.api

type Listener = (...args: unknown[]) => void

const listeners = new Map<string, Set<Listener>>()
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function goToLogin(): void {
  window.location.href = '/login'
}

/** POSTs a channel call and unwraps the `__raw` envelope the server adds. */
async function httpInvoke<T>(channel: string, args: unknown[]): Promise<T> {
  const response = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ channel, args })
  })

  if (response.status === 401) {
    goToLogin()
    // The page is navigating away; never resolve so callers do not act on a
    // half-authenticated state.
    return new Promise<T>(() => {})
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error || `Error ${response.status} en ${channel}`
    )
  }

  return (body as { __raw: T }).__raw
}

function connectSocket(): void {
  if (socket || typeof WebSocket === 'undefined') return

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/events`)
  socket = ws

  ws.onmessage = (event): void => {
    try {
      const { channel, args } = JSON.parse(event.data as string) as {
        channel: string
        args: unknown[]
      }
      for (const listener of listeners.get(channel) || []) {
        listener(...(args || []))
      }
    } catch (error) {
      console.warn('Malformed event from server', error)
    }
  }

  ws.onclose = (): void => {
    socket = null
    // The server restarts on port/bind changes, and laptops sleep. Keep trying.
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connectSocket()
      }, 2000)
    }
  }

  ws.onerror = (): void => ws.close()
}

/**
 * Native-dialog channels rerouted through the remote picker.
 *
 * Each one picks paths on the server and then hands them to the pure resolver
 * that the drag-and-drop path already used, so the data the caller receives is
 * byte-identical to the Electron one.
 */
async function invokeDialogChannel(channel: string, args: unknown[]): Promise<unknown> {
  switch (channel) {
    // Opening a link server-side would launch a browser on the *host* machine.
    // Handled client-side instead so it behaves the way the user expects.
    case 'shell:open-external': {
      window.open(args[0] as string, '_blank', 'noopener,noreferrer')
      return { success: true }
    }

    case 'dialog:select-directory': {
      const picked = await requestPick({ mode: 'directory' })
      return picked?.[0] ?? null
    }

    case 'dialog:select-file': {
      const picked = await requestPick({ mode: 'file' })
      return picked?.[0] ?? null
    }

    case 'dialog:select-files': {
      const picked = await requestPick({ mode: 'files' })
      return picked && picked.length > 0 ? picked : null
    }

    case 'dialog:save-file': {
      const picked = await requestPick({ mode: 'save', defaultName: args[0] as string })
      return picked?.[0] ?? null
    }

    case 'dialog:select-items': {
      const picked = await requestPick({ mode: 'items', defaultPath: args[0] as string })
      if (!picked || picked.length === 0) return null
      return httpInvoke('dialog:resolve-items', [picked])
    }

    case 'dialog:select-exclude-targets': {
      const repoPath = args[0] as string
      const picked = await requestPick({ mode: 'items', defaultPath: repoPath })
      if (!picked || picked.length === 0) return null
      return httpInvoke('dialog:resolve-exclude-targets', [repoPath, picked])
    }

    case 'dialog:select-folder-contents': {
      const picked = await requestPick({ mode: 'directory' })
      if (!picked || picked.length === 0) return null
      return httpInvoke('dialog:resolve-folder-contents', [picked[0]])
    }

    default:
      return httpInvoke(channel, args)
  }
}

function installWebApi(): void {
  window.api = {
    invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
      invokeDialogChannel(channel, args) as Promise<T>,

    on: (channel: string, callback: Listener): (() => void) => {
      connectSocket()
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(callback)
      return () => {
        set!.delete(callback)
      }
    },

    once: (channel: string, callback: Listener): void => {
      const off = window.api.on(channel, (...args) => {
        off()
        callback(...args)
      })
    },

    // The browser never exposes a real filesystem path for a dropped file.
    // Callers already skip empty strings, so a drop degrades to "nothing
    // happened" and the user picks through the remote browser instead.
    getPathForFile: (): string => '',

    selectDirectory: () =>
      invokeDialogChannel('dialog:select-directory', []) as Promise<string | null>,

    selectFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
      invokeDialogChannel('dialog:select-file', [filters]) as Promise<string | null>,

    saveFile: (defaultName: string) =>
      invokeDialogChannel('dialog:save-file', [defaultName]) as Promise<string | null>
  }
}

if (isWebMode) {
  installWebApi()
}
