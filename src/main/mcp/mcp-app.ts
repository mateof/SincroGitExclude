import express, { type Express, type Request, type Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { bearerOf, tokenMatches, type McpGrant } from './mcp-grants'

export interface McpGetRoute {
  path: string
  handler: (req: Request, res: Response, grant: McpGrant) => Promise<void>
}

export interface McpAppOptions {
  path: string
  authenticate: (authorization: string | undefined) => McpGrant | null
  buildServer: (grant: McpGrant) => McpServer
  getRoutes?: McpGetRoute[]
  onError?: (error: unknown) => void
}

export function bearerMatches(header: string | undefined, expected: string): boolean {
  const presented = bearerOf(header)
  return presented !== null && tokenMatches(presented, expected)
}

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null })
}

export function createMcpApp(options: McpAppOptions): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '10mb' }))

  app.post(options.path, async (req: Request, res: Response) => {
    const grant = options.authenticate(req.headers.authorization)
    if (!grant) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      rpcError(res, 401, -32001, 'Missing or invalid token. Copy the command again from Settings > MCP.')
      return
    }

    const server = options.buildServer(grant)
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

  for (const route of options.getRoutes ?? []) {
    app.get(route.path, async (req: Request, res: Response) => {
      const grant = options.authenticate(req.headers.authorization)
      if (!grant) {
        res.setHeader('WWW-Authenticate', 'Bearer')
        res.status(401).type('text/plain').send('Missing or invalid token')
        return
      }
      try {
        await route.handler(req, res, grant)
      } catch (error) {
        options.onError?.(error)
        if (!res.headersSent) res.status(500).type('text/plain').send('Internal error')
        else res.end()
      }
    })
  }

  const notAllowed = (_req: Request, res: Response): void =>
    rpcError(res, 405, -32000, 'Method not allowed. Use POST.')
  app.get(options.path, notAllowed)
  app.delete(options.path, notAllowed)

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: `Not found. The MCP endpoint is ${options.path}` })
  })

  return app
}
