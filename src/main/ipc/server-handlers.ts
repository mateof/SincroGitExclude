import { ipcMain } from 'electron'
import log from 'electron-log'
import { describeError } from '../utils/errors'
import { isWebEvent } from './channel-registry'
import { webServer } from '../server/http-server'
import {
  DEFAULT_PORT,
  readServerConfig,
  regenerateToken,
  setToken,
  validateToken,
  writeServerConfig
} from '../server/config'

function currentState(): Record<string, unknown> {
  const config = readServerConfig()
  const status = webServer.getStatus()
  return {
    // Configured values — `port` must come from the config, not from the
    // status, which reports null while the server is stopped and would blank
    // the field in Settings.
    enabled: config.enabled,
    port: config.port,
    bindAll: config.bindAll,
    token: config.token,
    defaultPort: DEFAULT_PORT,
    // Live values
    running: status.running,
    activePort: status.port,
    urls: status.urls,
    clients: status.clients
  }
}

export function registerServerHandlers(): void {
  ipcMain.handle('server:get-state', async () => {
    try {
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('server:start', async () => {
    try {
      writeServerConfig({ enabled: true })
      await webServer.start()
      return { success: true, data: currentState() }
    } catch (error) {
      // Leave `enabled` off so a bad port does not block the next app start
      writeServerConfig({ enabled: false })
      log.error('Failed to start web server:', error)
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('server:stop', async (event) => {
    if (isWebEvent(event)) {
      return {
        success: false,
        error: 'El servidor solo se puede detener desde la ventana de escritorio.'
      }
    }
    try {
      await webServer.stop()
      writeServerConfig({ enabled: false })
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  /**
   * Port and bind address only. Changing either restarts the listener, which
   * drops every browser client, so this is refused over HTTP.
   */
  ipcMain.handle('server:set-config', async (event, patch: { port?: number; bindAll?: boolean }) => {
    if (isWebEvent(event)) {
      return {
        success: false,
        error: 'La configuracion del servidor solo se puede cambiar desde la ventana de escritorio.'
      }
    }

    try {
      const next: { port?: number; bindAll?: boolean } = {}

      if (patch?.port !== undefined) {
        const port = Number(patch.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return { success: false, error: 'Puerto invalido (1-65535)' }
        }
        next.port = port
      }
      if (patch?.bindAll !== undefined) {
        next.bindAll = patch.bindAll === true
      }

      writeServerConfig(next)

      if (webServer.isRunning()) {
        await webServer.stop()
        await webServer.start()
      }

      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  /**
   * Replaces the token with one the user typed. Like a regeneration, it signs
   * out every open session, so it is refused over HTTP: a browser client would
   * be locking itself out mid-request.
   */
  ipcMain.handle('server:set-token', async (event, token: string) => {
    if (isWebEvent(event)) {
      return {
        success: false,
        error: 'El token solo se puede cambiar desde la ventana de escritorio.'
      }
    }
    try {
      const problem = validateToken(token)
      if (problem) return { success: false, error: problem }

      setToken(token)
      log.info('Web server access token changed - existing sessions invalidated')
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  /** Invalidates every session cookie already issued. */
  ipcMain.handle('server:regenerate-token', async (event) => {
    if (isWebEvent(event)) {
      return {
        success: false,
        error: 'El token solo se puede regenerar desde la ventana de escritorio.'
      }
    }
    try {
      regenerateToken()
      log.info('Web server access token regenerated — existing sessions invalidated')
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })
}
