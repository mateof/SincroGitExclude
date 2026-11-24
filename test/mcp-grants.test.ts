import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'net'
import { createServer, type Server } from 'http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpApp } from '../src/main/mcp/mcp-app'
import { buildMcpServer } from '../src/main/mcp/build-server'
import { resolveGrant, normalizeTokens, type McpToken } from '../src/main/mcp/mcp-grants'

const PRIMARY = 'sge_primary_token_123456789'
const TOKENS: McpToken[] = [
  {
    id: 'laptop',
    name: 'Laptop',
    token: 'sge_kb_reader_token_1234567',
    scopes: ['kb:read'],
    spaces: ['space-a'],
    createdAt: '2026-11-23T00:00:00.000Z'
  },
  {
    id: 'writer',
    name: 'Writer',
    token: 'sge_kb_writer_token_1234567',
    scopes: ['kb:read', 'kb:write'],
    spaces: null,
    createdAt: '2026-11-23T00:00:00.000Z'
  }
]

let server: Server
let url: string

async function toolNames(token: string): Promise<string[]> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  )
  const { tools } = await client.listTools()
  await client.close()
  return tools.map((t) => t.name).sort()
}

beforeAll(async () => {
  const app = createMcpApp({
    path: '/mcp',
    authenticate: (header) => resolveGrant(header, PRIMARY, TOKENS),
    buildServer: (grant) =>
      buildMcpServer({ version: '0.0.0-test', readOnly: false, grant, onWrite: () => {}, selfStatus: () => ({}) })
  })
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('MCP tokens with scopes', () => {
  it('gives the primary token every tool, from both areas', async () => {
    const names = await toolNames(PRIMARY)
    expect(names).toContain('list_files')
    expect(names).toContain('kb_create')
  })

  it('shows a knowledge-only reader nothing that writes and nothing from the excluded files area', async () => {
    const names = await toolNames(TOKENS[0].token)
    expect(names.every((n) => n.startsWith('kb_'))).toBe(true)
    expect(names).toContain('kb_search')
    expect(names).not.toContain('kb_create')
  })

  it('lets a knowledge writer write notes but still not touch managed files', async () => {
    const names = await toolNames(TOKENS[1].token)
    expect(names).toContain('kb_patch_section')
    expect(names).not.toContain('delete_file')
  })

  it('rejects an unknown token', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer sge_not_a_real_token_000000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
    expect(response.status).toBe(401)
  })

  it('keeps the space restriction of a token', () => {
    const grant = resolveGrant(`Bearer ${TOKENS[0].token}`, PRIMARY, TOKENS)
    expect(grant?.spaces).toEqual(['space-a'])
    expect(grant?.scopes.has('kb:write')).toBe(false)
  })

  it('drops malformed tokens from mcp.json instead of trusting them', () => {
    expect(
      normalizeTokens([
        { id: 'x', token: 'short', scopes: ['kb:read'] },
        { id: 'y', token: 'sge_long_enough_token_12345', scopes: ['root:all'] },
        TOKENS[0]
      ]).map((t) => t.id)
    ).toEqual(['laptop'])
  })
})
