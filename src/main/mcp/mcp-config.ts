import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { DEFAULT_DATA_DIR } from '../app-paths'

export const MCP_CONFIG_PATH = join(DEFAULT_DATA_DIR, 'mcp.json')
export const DEFAULT_MCP_PORT = 8766
export const MCP_PATH = '/mcp'

export interface McpConfig {
  enabled: boolean
  port: number
  bindAll: boolean
  readOnly: boolean
  token: string
}

function generateToken(): string {
  return `sge_${randomBytes(24).toString('base64url')}`
}

function defaults(): McpConfig {
  return { enabled: false, port: DEFAULT_MCP_PORT, bindAll: false, readOnly: false, token: generateToken() }
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
        token: typeof parsed.token === 'string' && parsed.token.length >= 16 ? parsed.token : base.token
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
