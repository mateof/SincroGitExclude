import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { DEFAULT_DATA_DIR } from '../app-paths'
import {
  ALL_SCOPES,
  generateToken,
  normalizeTokens,
  type McpScope,
  type McpToken
} from './mcp-grants'

export { ALL_SCOPES, type McpScope, type McpToken } from './mcp-grants'

export const MCP_CONFIG_PATH = join(DEFAULT_DATA_DIR, 'mcp.json')
export const DEFAULT_MCP_PORT = 8766
export const MCP_PATH = '/mcp'

export interface McpConfig {
  enabled: boolean
  port: number
  bindAll: boolean
  readOnly: boolean
  token: string
  tokens: McpToken[]
  preventSleep: boolean
}

function defaults(): McpConfig {
  return {
    enabled: false,
    port: DEFAULT_MCP_PORT,
    bindAll: false,
    readOnly: false,
    token: generateToken(),
    tokens: [],
    preventSleep: false
  }
}

let cached: McpConfig | null = null

export function readMcpConfig(): McpConfig {
  if (cached) return cached
  const base = defaults()
  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8')) as Partial<McpConfig>
      cached = {
        enabled: parsed.enabled === true,
        port:
          typeof parsed.port === 'number' && parsed.port > 0 && parsed.port < 65536 ? parsed.port : base.port,
        bindAll: parsed.bindAll === true,
        readOnly: parsed.readOnly === true,
        token: typeof parsed.token === 'string' && parsed.token.length >= 16 ? parsed.token : base.token,
        tokens: normalizeTokens(parsed.tokens),
        preventSleep: parsed.preventSleep === true
      }
      return cached
    } catch (error) {
      log.warn('Invalid mcp.json, falling back to defaults:', error)
    }
  }
  cached = base
  return cached
}

export function writeMcpConfig(patch: Partial<McpConfig>): McpConfig {
  const next = { ...readMcpConfig(), ...patch }
  cached = next
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function regenerateMcpToken(): McpConfig {
  return writeMcpConfig({ token: generateToken() })
}

export function createMcpToken(name: string, scopes: McpScope[], spaces: string[] | null): McpToken {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('The token needs a name')
  const valid = scopes.filter((s) => ALL_SCOPES.includes(s))
  if (valid.length === 0) throw new Error('Choose at least one permission')
  const token: McpToken = {
    id: generateToken().slice(4, 16),
    name: cleanName.slice(0, 80),
    token: generateToken(),
    scopes: valid,
    spaces: spaces && spaces.length > 0 ? spaces : null,
    createdAt: new Date().toISOString()
  }
  writeMcpConfig({ tokens: [...readMcpConfig().tokens, token] })
  return token
}

export function revokeMcpToken(id: string): void {
  writeMcpConfig({ tokens: readMcpConfig().tokens.filter((t) => t.id !== id) })
}
