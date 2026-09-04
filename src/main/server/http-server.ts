import { createServer, type Server as HttpServer } from 'http'
import { networkInterfaces } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import express, { type Express, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import log from 'electron-log'
import { describeError } from '../utils/errors'
import { invokeChannel, isKnownChannel } from '../ipc/channel-registry'
import {
  clearFailures,
  clearSessionCookie,
  isRateLimited,
  isValidToken,
  recordFailure,
  requireAuth,
  setSessionCookie
} from './auth'
import { readServerConfig } from './config'
import { LOGIN_PAGE, NO_BUILD_PAGE } from './login-page'
import { WsHub } from './ws-hub'

/** Where the built renderer lives relative to the bundled main process. */
const RENDERER_DIR = join(__dirname, '../renderer')

export interface ServerStatus {
  running: boolean
  port: number | null
  bindAll: boolean
  urls: string[]
  clients: number
}

/** Every non-internal IPv4 address, so Settings can show a URL that works from another machine. */
function lanAddresses(): string[] {
  const found: string[] = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        found.push(address.address)
      }
    }
  }
  return found
}

export class WebServer {
  private server: HttpServer | null = null
  private hub = new WsHub()
  private port: number | null = null

  isRunning(): boolean {
    return this.server !== null
  }

  broadcast(channel: string, ...args: unknown[]): void {
    this.hub.broadcast(channel, ...args)
  }

  getStatus(): ServerStatus {
    const config = readServerConfig()
    return {
      running: this.isRunning(),
      port: this.port,
      bindAll: config.bindAll,
      urls: this.isRunning() ? this.buildUrls() : [],
      clients: this.hub.clientCount
    }
  }

  private buildUrls(): string[] {
    const config = readServerConfig()
    const urls = [`http://localhost:${this.port}`]
    if (config.bindAll) {
      for (const address of lanAddresses()) {
        urls.push(`http://${address}:${this.port}`)
      }
    }
    return urls
  }

  private buildApp(): Express {
    const app = express()

    // Bundle metadata (file lists for large bundles) travels in the invoke body
    app.use(express.json({ limit: '25mb' }))
    app.use(cookieParser())

    app.get('/login', (_req: Request, res: Response) => {
      res.type('html').send(LOGIN_PAGE)
    })

    app.post('/api/session', (req: Request, res: Response) => {
      if (isRateLimited(req)) {
        res
          .status(429)
          .json({ success: false, error: 'Demasiados intentos fallidos. Espera 15 minutos.' })
        return
      }

      if (!isValidToken((req.body as { token?: unknown } | undefined)?.token)) {
        recordFailure(req)
        res.status(401).json({ success: false, error: 'Token invalido' })
        return
      }

      clearFailures(req)
      setSessionCookie(res)
      log.info(`Web client authenticated from ${req.socket.remoteAddress}`)
      res.json({ success: true })
    })

    app.post('/api/logout', (_req: Request, res: Response) => {
      clearSessionCookie(res)
      res.json({ success: true })
    })

    app.use(requireAuth)

    app.post('/api/invoke', async (req: Request, res: Response) => {
      const { channel, args } = (req.body || {}) as { channel?: unknown; args?: unknown }

      if (typeof channel !== 'string' || !isKnownChannel(channel)) {
        res.status(404).json({ success: false, error: `Unknown channel: ${String(channel)}` })
        return
      }

      try {
        const result = await invokeChannel(channel, Array.isArray(args) ? args : [])
        // Wrapped in __raw because a handler's return value is not always the
        // { success, data, error } envelope — the dialog helpers return bare
        // strings, arrays or null, and `null` alone is not a valid JSON body.
        // The shim unwraps it so call sites see exactly what IPC would return.
        res.json({ __raw: result })
      } catch (error) {
        log.error(`Web invoke failed for ${channel}:`, error)
        res.status(500).json({ success: false, error: describeError(error) })
      }
    })

    if (existsSync(RENDERER_DIR)) {
      app.use(express.static(RENDERER_DIR))
      // SPA fallback. Express 5 rejects the old '*' route pattern, so this is
      // plain terminal middleware instead of a wildcard route.
      app.use((_req: Request, res: Response) => {
        res.sendFile(join(RENDERER_DIR, 'index.html'))
      })
    } else {
      log.warn(`Web server: renderer build not found at ${RENDERER_DIR}`)
      app.use((_req: Request, res: Response) => {
        res.status(503).type('html').send(NO_BUILD_PAGE)
      })
    }

    return app
  }

  async start(): Promise<ServerStatus> {
    if (this.server) return this.getStatus()

    const config = readServerConfig()
    const host = config.bindAll ? '0.0.0.0' : '127.0.0.1'
    const server = createServer(this.buildApp())

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        reject(
          error.code === 'EADDRINUSE'
            ? new Error(`El puerto ${config.port} ya esta en uso`)
            : error
        )
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(config.port, host)
    })

    this.hub.attach(server)
    this.server = server
    this.port = config.port

    log.info(`Web server listening on ${host}:${config.port} (bindAll: ${config.bindAll})`)
    if (config.bindAll) {
      log.warn('Web server is reachable from the network — access requires the token')
    }

    return this.getStatus()
  }

  async stop(): Promise<void> {
    if (!this.server) return

    this.hub.close()
    const server = this.server
    this.server = null
    this.port = null

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // close() waits for keep-alive sockets; nudge them shut so a restart is instant
      server.closeAllConnections?.()
    })

    log.info('Web server stopped')
  }
}

export const webServer = new WebServer()
