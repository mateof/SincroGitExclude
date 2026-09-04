import type { Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import log from 'electron-log'
import { isAuthenticatedCookieHeader } from './auth'

export const EVENTS_PATH = '/api/events'

/**
 * Fan-out of main-process push events to every connected browser client.
 *
 * The Electron window keeps receiving the same events through
 * `webContents.send`; this hub is the second listener, not a replacement.
 */
export class WsHub {
  private wss: WebSocketServer | null = null

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (request, socket, head) => {
      const url = request.url || ''
      if (!url.startsWith(EVENTS_PATH)) {
        socket.destroy()
        return
      }

      if (!isAuthenticatedCookieHeader(request.headers.cookie)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit('connection', ws, request)
      })
    })

    this.wss.on('connection', (ws) => {
      log.info(`Web client connected (${this.clientCount} total)`)
      ws.on('close', () => log.info(`Web client disconnected (${this.clientCount} left)`))
      ws.on('error', (error) => log.warn('Web client socket error:', error))
    })
  }

  get clientCount(): number {
    if (!this.wss) return 0
    let count = 0
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) count++
    }
    return count
  }

  broadcast(channel: string, ...args: unknown[]): void {
    if (!this.wss) return
    const payload = JSON.stringify({ channel, args })
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch (error) {
          log.warn(`Failed to push ${channel} to a web client:`, error)
        }
      }
    }
  }

  close(): void {
    if (!this.wss) return
    for (const client of this.wss.clients) {
      try {
        client.close()
      } catch {
        // client already gone
      }
    }
    this.wss.close()
    this.wss = null
  }
}
