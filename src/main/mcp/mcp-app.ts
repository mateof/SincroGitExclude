import express, { type Express, type Request, type Response } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export interface McpAppOptions {
  path: string
  getToken: () => string
  buildServer: () => McpServer
  onError?: (error: unknown) => void
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  return timingSafeEqual(digest(header.slice(7).trim()), digest(expected))
}

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null })
}

export function createMcpApp(options: McpAppOptions): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '10mb' }))

  app.post(options.path, async (req: Request, res: Response) => {
    if (!bearerMatches(req.headers.authorization, options.getToken())) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      rpcError(res, 401, -32001, 'Missing or invalid token. Copy the command again from Settings > MCP.')
      return
    }

    const server = options.buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => {
      void transport.close().catch(() => {})
      void server.close().catch(() => {})
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      options.onError?.(error)
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error')
      else res.end()
    }
  })

  const notAllowed = (_req: Request, res: Response): void =>
    rpcError(res, 405, -32000, 'Method not allowed. Use POST.')
  app.get(options.path, notAllowed)
  app.delete(options.path, notAllowed)

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: `Not found. The MCP endpoint is ${options.path}` })
  })

  return app
}
