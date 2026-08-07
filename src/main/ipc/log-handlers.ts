import { describeError } from '../utils/errors'
import { ipcMain, shell } from 'electron'
import { existsSync, readFileSync } from 'fs'
import log from 'electron-log'

export interface LogEntry {
  timestamp: string
  level: string
  message: string
}

/**
 * electron-log file format: `[2026-08-07 12:00:00.000] [info]  message`
 * Lines that don't match (stack traces, multi-line payloads) are appended to
 * the previous entry so an error and its stack stay together.
 */
const LINE_RE = /^\[([^\]]+)\]\s+\[(\w+)\]\s*(.*)$/

function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

function parseLog(raw: string, limit: number): LogEntry[] {
  const entries: LogEntry[] = []

  for (const line of raw.split(/\r?\n/)) {
    const match = LINE_RE.exec(line)
    if (match) {
      entries.push({ timestamp: match[1], level: match[2], message: match[3] })
    } else if (line.trim() && entries.length > 0) {
      entries[entries.length - 1].message += '\n' + line
    }
  }

  return entries.length > limit ? entries.slice(entries.length - limit) : entries
}

export function registerLogHandlers(): void {
  ipcMain.handle('logs:info', () => {
    try {
      const file = log.transports.file.getFile()
      return {
        success: true,
        data: {
          path: file.path,
          size: file.size,
          verbose: log.transports.file.level === 'debug'
        }
      }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('logs:read', (_, limit: number = 500) => {
    try {
      const path = getLogFilePath()
      if (!existsSync(path)) {
        return { success: true, data: { path, entries: [] } }
      }
      const raw = readFileSync(path, 'utf-8')
      return { success: true, data: { path, entries: parseLog(raw, limit) } }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('logs:clear', () => {
    try {
      log.transports.file.getFile().clear()
      log.info('Log cleared by user')
      return { success: true }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('logs:open-folder', () => {
    try {
      shell.showItemInFolder(getLogFilePath())
      return { success: true }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  // Verbose mode writes every IPC call to the file (debug level).
  // Off by default to keep the log readable and small.
  ipcMain.handle('logs:set-verbose', (_, verbose: boolean) => {
    try {
      log.transports.file.level = verbose ? 'debug' : 'info'
      return { success: true }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  // Lets the renderer record what the user was doing when something failed
  ipcMain.handle('logs:write', (_, level: string, message: string) => {
    try {
      const fn = (log as unknown as Record<string, (msg: string) => void>)[level] ?? log.info
      fn(`[ui] ${message}`)
      return { success: true }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })
}
