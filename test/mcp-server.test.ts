import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { AddressInfo } from 'net'
import { createServer, type Server } from 'http'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { registerChannel } from '../src/main/ipc/channel-registry'
import { createMcpApp } from '../src/main/mcp/mcp-app'
import { buildMcpServer } from '../src/main/mcp/build-server'
import { resolveDeployTarget } from '../src/main/mcp/tools/deployments.tools'

const TOKEN = 'sge_test_token_1234567890'
const calls: Array<{ channel: string; args: unknown[] }> = []
const writes: string[] = []
let readOnly = false
let server: Server
let url: string

function fake(channel: string, result: (args: unknown[]) => unknown): void {
  registerChannel(channel, async (_event, ...args) => {
    calls.push({ channel, args })
    return result(args)
  })
}

async function connect(token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  )
  return client
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text
}

beforeAll(async () => {
  fake('files:list', () => ({
    success: true,
    data: [
      { id: 'f1', name: '.env', alias: 'Env', type: 'file', use_auto_icon: 1, created_at: 'a', updated_at: 'b', tags: [{ name: 'secret' }] },
      { id: 'f2', name: 'cfg', alias: 'Config', type: 'bundle', use_auto_icon: 1, created_at: 'a', updated_at: 'b', tags: [] }
    ]
  }))
  fake('deployments:stats', () => ({ success: true, data: { fileIdsWithChanges: ['f2'] } }))
  fake('tags:list', () => ({ success: true, data: [{ id: 't1', name: 'secret', color: '#000' }] }))
  fake('tags:create', (args) => ({ success: true, data: { id: 't-new', name: args[0], color: args[1] } }))
  fake('files:update', () => ({ success: false, error: 'File not found' }))
  fake('files:set-tags', () => ({ success: true }))
  fake('server:get-state', () => ({ success: true, data: { running: false, token: 'web-secret' } }))
  fake('preferences:get', () => ({ success: true, data: { preferences: { autoExclude: true }, migrated: true } }))
  fake('app:get-paths', () => ({ success: true, data: { appDataDir: '/data' } }))
  fake('sync:get-config', () => ({ success: true, data: { remoteUrl: '' } }))

  const app = createMcpApp({
    path: '/mcp',
    getToken: () => TOKEN,
    buildServer: () =>
      buildMcpServer({
        version: '0.0.0-test',
        readOnly,
        onWrite: (tool) => writes.push(tool),
        selfStatus: () => ({ running: true })
      })
  })
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

beforeEach(() => {
  calls.length = 0
  writes.length = 0
  readOnly = false
})

describe('MCP server', () => {
  it('rejects requests without the right bearer token', async () => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(401)
    await expect(connect('wrong-token')).rejects.toThrow()
  })

  it('answers GET with 405 because the server is stateless', async () => {
    expect((await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
  })

  it('exposes read and write tools, with instructions for the assistant', async () => {
    const client = await connect()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_overview', 'list_files', 'create_deployment', 'commit_changes', 'sync_push', 'update_settings']))
    expect(names.length).toBeGreaterThan(50)
    expect(client.getInstructions()).toContain('A deployment places a managed file')
    await client.close()
  })

  it('hides every write tool in read-only mode instead of refusing them later', async () => {
    readOnly = true
    const client = await connect()
    const tools = (await client.listTools()).tools
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.map((t) => t.name)).not.toContain('delete_file')
    await client.close()
  })

  it('marks destructive tools so clients can ask before running them', async () => {
    const client = await connect()
    const tools = (await client.listTools()).tools
    expect(tools.find((t) => t.name === 'delete_file')?.annotations?.destructiveHint).toBe(true)
    expect(tools.find((t) => t.name === 'create_file')?.annotations?.destructiveHint).toBe(false)
    await client.close()
  })

  it('goes through the same channels as the UI and filters on top', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'list_files', arguments: { tag: 'SECRET' } })
    const files = JSON.parse(textOf(result))
    expect(files).toEqual([expect.objectContaining({ id: 'f1', tags: ['secret'], hasPendingChanges: false })])
    expect(calls.map((c) => c.channel).sort()).toEqual(['deployments:stats', 'files:list'])
    expect(writes).toEqual([])
    await client.close()
  })

  it('returns channel errors as tool errors with the real message', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'update_file', arguments: { fileId: 'x', name: 'y' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('File not found')
    expect(writes).toEqual([])
    await client.close()
  })

  it('creates missing tags by name and notifies the UI after a write', async () => {
    const client = await connect()
    const result = await client.callTool({
      name: 'set_tags',
      arguments: { target: 'file', id: 'f1', tags: ['secret', 'nuevo'] }
    })
    expect(result.isError).toBeFalsy()
    expect(calls.find((c) => c.channel === 'tags:create')?.args[0]).toBe('nuevo')
    expect(calls.find((c) => c.channel === 'files:set-tags')?.args).toEqual(['f1', ['t1', 't-new']])
    expect(writes).toEqual(['set_tags'])
    await client.close()
  })

  it('never hands out the web access token', async () => {
    const client = await connect()
    const text = textOf(await client.callTool({ name: 'get_settings', arguments: {} }))
    expect(text).not.toContain('web-secret')
    expect(JSON.parse(text).mcp).toEqual({ running: true })
    await client.close()
  })

  it('validates arguments before touching any channel', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'create_tag', arguments: { name: 'x', color: 'red' } })
    expect(result.isError).toBe(true)
    expect(calls.find((c) => c.channel === 'tags:create')).toBeUndefined()
    await client.close()
  })
})

describe('deploy target resolution', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sge-target-'))
    mkdirSync(join(root, 'repo', '.git'), { recursive: true })
    mkdirSync(join(root, 'repo', 'config'), { recursive: true })
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('appends the file name when a single file is deployed into a folder', () => {
    expect(resolveDeployTarget(join(root, 'repo', 'config'), { name: '.env', type: 'file' })).toEqual({
      repoPath: join(root, 'repo'),
      relativePath: 'config/.env'
    })
  })

  it('accepts a bundle folder that does not exist yet', () => {
    expect(resolveDeployTarget(join(root, 'repo', 'tools', 'local'), { name: 'x', type: 'bundle' })).toEqual({
      repoPath: join(root, 'repo'),
      relativePath: 'tools/local'
    })
  })

  it('refuses a file whose name does not match, the repo root and relative paths', () => {
    expect(() => resolveDeployTarget(join(root, 'repo', 'config', 'other'), { name: '.env', type: 'file' })).toThrow(/deploys as/)
    expect(() => resolveDeployTarget(join(root, 'repo'), { name: 'x', type: 'bundle' })).toThrow(/root/)
    expect(() => resolveDeployTarget('repo/config', { name: 'x', type: 'bundle' })).toThrow(/absolute/)
    expect(() => resolveDeployTarget(join(root, 'nowhere'), { name: 'x', type: 'bundle' })).toThrow(/git repository/)
  })
})
