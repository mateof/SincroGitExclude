import { ipcMain } from 'electron'
import log from 'electron-log'
import { describeError } from '../utils/errors'
import { mcpServer } from '../mcp/mcp-server'
import { DEFAULT_MCP_PORT, readMcpConfig, regenerateMcpToken, writeMcpConfig } from '../mcp/mcp-config'
import { buildClientSnippets, type Platform, type Shell } from '../mcp/mcp-clients'

function currentState(): Record<string, unknown> {
  const config = readMcpConfig()
  const status = mcpServer.getStatus()
  return {
    enabled: config.enabled,
    port: config.port,
    bindAll: config.bindAll,
    readOnly: config.readOnly,
    token: config.token,
    defaultPort: DEFAULT_MCP_PORT,
    platform: process.platform,
    running: status.running,
    urls: status.urls.length > 0 ? status.urls : [`http://127.0.0.1:${config.port}/mcp`]
  }
}

async function restartIfRunning(): Promise<void> {
  if (!mcpServer.isRunning()) return
  await mcpServer.stop()
  await mcpServer.start()
}

export function registerMcpHandlers(): void {
  ipcMain.handle('mcp:get-state', async () => {
    try {
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('mcp:start', async () => {
    try {
      writeMcpConfig({ enabled: true })
      await mcpServer.start()
      return { success: true, data: currentState() }
    } catch (error) {
      writeMcpConfig({ enabled: false })
      log.error('Failed to start MCP server:', error)
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('mcp:stop', async () => {
    try {
      writeMcpConfig({ enabled: false })
      await mcpServer.stop()
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle(
    'mcp:set-config',
    async (_, patch: { port?: number; bindAll?: boolean; readOnly?: boolean }) => {
      try {
        const next: { port?: number; bindAll?: boolean; readOnly?: boolean } = {}
        if (patch?.port !== undefined) {
          const port = Number(patch.port)
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return { success: false, error: 'Invalid port (1-65535)' }
          }
          next.port = port
        }
        if (patch?.bindAll !== undefined) next.bindAll = patch.bindAll === true
        if (patch?.readOnly !== undefined) next.readOnly = patch.readOnly === true
        writeMcpConfig(next)
        if (next.port !== undefined || next.bindAll !== undefined) await restartIfRunning()
        return { success: true, data: currentState() }
      } catch (error) {
        return { success: false, error: describeError(error) }
      }
    }
  )

  ipcMain.handle('mcp:regenerate-token', async () => {
    try {
      regenerateMcpToken()
      return { success: true, data: currentState() }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })

  ipcMain.handle('mcp:clients', async (_, url: string, shell: Shell) => {
    try {
      const platform = (['darwin', 'win32', 'linux'].includes(process.platform)
        ? process.platform
        : 'linux') as Platform
      const safeShell: Shell = ['bash', 'powershell', 'cmd'].includes(shell) ? shell : 'bash'
      return {
        success: true,
        data: buildClientSnippets({ url, token: readMcpConfig().token, shell: safeShell, platform })
      }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })
}
