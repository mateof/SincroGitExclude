import { createServer, type Server } from 'http'
import { app, powerSaveBlocker } from 'electron'
import log from 'electron-log'
import { pushEvent } from '../events'
import { lanAddresses } from '../server/http-server'
import { buildMcpServer } from './build-server'
import { createMcpApp } from './mcp-app'
import { MCP_PATH, readMcpConfig } from './mcp-config'
import { resolveGrant } from './mcp-grants'
import { mcpGetRoutes } from './mcp-routes'

export interface McpStatus {
  running: boolean
  port: number | null
  urls: string[]
}

class McpHttpServer {
  private server: Server | null = null
  private port: number | null = null
  private sleepBlocker: number | null = null

  applySleepPolicy(): void {
    const config = readMcpConfig()
    const want = this.server !== null && config.bindAll && config.preventSleep
    if (want && this.sleepBlocker === null) {
      this.sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!want && this.sleepBlocker !== null) {
      powerSaveBlocker.stop(this.sleepBlocker)
      this.sleepBlocker = null
    }
  }

  isRunning(): boolean {
    return this.server !== null
  }

  getStatus(): McpStatus {
    if (!this.server || this.port === null) return { running: false, port: null, urls: [] }
    const urls = [`http://127.0.0.1:${this.port}${MCP_PATH}`]
    if (readMcpConfig().bindAll) {
      for (const address of lanAddresses()) urls.push(`http://${address}:${this.port}${MCP_PATH}`)
    }
    return { running: true, port: this.port, urls }
  }

  async start(): Promise<McpStatus> {
    if (this.server) return this.getStatus()
    const config = readMcpConfig()
    const host = config.bindAll ? '0.0.0.0' : '127.0.0.1'

    const handler = createMcpApp({
      path: MCP_PATH,
      authenticate: (header) => {
        const current = readMcpConfig()
        return resolveGrant(header, current.token, current.tokens)
      },
      getRoutes: mcpGetRoutes(),
      buildServer: (grant) => {
        const current = readMcpConfig()
        return buildMcpServer({
          version: app.getVersion(),
          readOnly: current.readOnly,
          grant,
          onWrite: (tool) => pushEvent('app:data-changed', { source: 'mcp', tool }),
          selfStatus: () => ({ ...this.getStatus(), readOnly: current.readOnly, bindAll: current.bindAll })
        })
      },
      onError: (error) => log.error('MCP request failed:', error)
    })

    const server = createServer(handler)
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        reject(error.code === 'EADDRINUSE' ? new Error(`Port ${config.port} is already in use`) : error)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(config.port, host)
    })

    this.server = server
    this.port = config.port
    log.info(`MCP server listening on ${host}:${config.port}${MCP_PATH} (readOnly: ${config.readOnly})`)
    this.applySleepPolicy()
    return this.getStatus()
  }

  async stop(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.port = null
    this.applySleepPolicy()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
    log.info('MCP server stopped')
  }
}

export const mcpServer = new McpHttpServer()
