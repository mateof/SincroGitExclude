import { timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import log from 'electron-log'
import { readServerConfig, sessionValue } from './config'

export const SESSION_COOKIE = 'sge_session'

const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

interface Attempts {
  count: number
  resetAt: number
}

const attemptsByIp = new Map<string, Attempts>()

function clientIp(req: Request): string {
  return req.socket.remoteAddress || 'unknown'
}

/** Constant-time compare that also tolerates length mismatches. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function isRateLimited(req: Request): boolean {
  const entry = attemptsByIp.get(clientIp(req))
  if (!entry) return false
  if (Date.now() > entry.resetAt) {
    attemptsByIp.delete(clientIp(req))
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

export function recordFailure(req: Request): void {
  const ip = clientIp(req)
  const entry = attemptsByIp.get(ip)
  if (!entry || Date.now() > entry.resetAt) {
    attemptsByIp.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS })
    return
  }
  entry.count += 1
  if (entry.count === MAX_ATTEMPTS) {
    log.warn(`Web server: too many failed logins from ${ip}, blocked for 15 minutes`)
  }
}

export function clearFailures(req: Request): void {
  attemptsByIp.delete(clientIp(req))
}

export function isValidToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  return safeEqual(candidate, readServerConfig().token)
}

export function isAuthenticated(req: Request): boolean {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]
  if (!cookie) return false
  return safeEqual(cookie, sessionValue(readServerConfig()))
}

/** Parses a raw Cookie header — used on the WebSocket upgrade, which has no cookie-parser. */
export function isAuthenticatedCookieHeader(header: string | undefined): boolean {
  if (!header) return false
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) {
      return safeEqual(decodeURIComponent(rest.join('=')), sessionValue(readServerConfig()))
    }
  }
  return false
}

export function setSessionCookie(res: Response): void {
  res.cookie(SESSION_COOKIE, sessionValue(readServerConfig()), {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE)
}

/**
 * Gate for everything except the login page and the session endpoint.
 *
 * API calls get a 401 the shim can act on; page loads get redirected to the
 * login screen so a browser hitting the root sees something useful.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next()
    return
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ success: false, error: 'Not authenticated' })
    return
  }

  res.redirect('/login')
}
