import { randomBytes, createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { DEFAULT_DATA_DIR } from '../app-paths'

/**
 * Web server settings live in DEFAULT_DATA_DIR, never in the configurable data
 * directory: the server must be able to start even when the data directory is
 * missing, unreadable or on a broken cloud mount.
 */
export const SERVER_CONFIG_PATH = join(DEFAULT_DATA_DIR, 'server.json')

export const DEFAULT_PORT = 8765

export interface ServerConfig {
  /** Start the HTTP server when the app boots */
  enabled: boolean
  port: number
  /** false → bind 127.0.0.1 (default). true → bind 0.0.0.0, reachable from the LAN */
  bindAll: boolean
  /** Access token the browser exchanges for a session cookie */
  token: string
  /** Random per-install value mixed into the session cookie */
  salt: string
}

export const MIN_TOKEN_LENGTH = 8
export const MAX_TOKEN_LENGTH = 128

function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Rules for a hand-picked token. Whitespace is rejected because the token is
 * typed into a single-line field and a stray leading space would be impossible
 * to spot; control characters because they cannot be typed back at all.
 */
export function validateToken(value: unknown): string | null {
  if (typeof value !== 'string') return 'Token invalido'
  if (value.length < MIN_TOKEN_LENGTH) {
    return `El token debe tener al menos ${MIN_TOKEN_LENGTH} caracteres`
  }
  if (value.length > MAX_TOKEN_LENGTH) {
    return `El token no puede superar los ${MAX_TOKEN_LENGTH} caracteres`
  }
  // eslint-disable-next-line no-control-regex
  if (/\s/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return 'El token no puede contener espacios ni caracteres de control'
  }
  return null
}

function createDefaults(): ServerConfig {
  return {
    enabled: false,
    port: DEFAULT_PORT,
    bindAll: false,
    token: generateToken(),
    salt: randomBytes(16).toString('hex')
  }
}

let cached: ServerConfig | null = null

export function readServerConfig(): ServerConfig {
  if (cached) return cached

  if (existsSync(SERVER_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(SERVER_CONFIG_PATH, 'utf-8')) as Partial<ServerConfig>
      const defaults = createDefaults()
      cached = {
        enabled: parsed.enabled === true,
        port:
          typeof parsed.port === 'number' && parsed.port > 0 && parsed.port < 65536
            ? parsed.port
            : defaults.port,
        bindAll: parsed.bindAll === true,
        token: typeof parsed.token === 'string' && parsed.token ? parsed.token : defaults.token,
        salt: typeof parsed.salt === 'string' && parsed.salt ? parsed.salt : defaults.salt
      }
      return cached
    } catch (error) {
      log.warn('Invalid server.json, falling back to defaults:', error)
    }
  }

  cached = createDefaults()
  return cached
}

export function writeServerConfig(patch: Partial<ServerConfig>): ServerConfig {
  const next = { ...readServerConfig(), ...patch }
  cached = next
  writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

/** Regenerating the token invalidates every session cookie already issued. */
export function regenerateToken(): ServerConfig {
  return writeServerConfig({ token: generateToken(), salt: randomBytes(16).toString('hex') })
}

/**
 * Replaces the token with a hand-picked one. The salt is rotated too, so open
 * sessions die exactly as they do on a regeneration.
 */
export function setToken(token: string): ServerConfig {
  return writeServerConfig({ token, salt: randomBytes(16).toString('hex') })
}

/**
 * Value stored in the session cookie. Derived from token + salt rather than
 * random, so sessions survive an app restart but die the moment the token is
 * regenerated.
 */
export function sessionValue(config: ServerConfig): string {
  return createHash('sha256').update(`${config.token}:${config.salt}`).digest('hex')
}
