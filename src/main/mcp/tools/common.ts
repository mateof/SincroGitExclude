import type { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { invokeChannel } from '../../ipc/channel-registry'

export const MAX_TEXT = 100_000

export class ToolFailure extends Error {}

export interface ToolContext {
  server: McpServer
  readOnly: boolean
  onWrite: (tool: string) => void
  selfStatus: () => Record<string, unknown>
}

export async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await invokeChannel<unknown>(channel, args, 'mcp')
  if (result !== null && typeof result === 'object' && 'success' in (result as Record<string, unknown>)) {
    const envelope = result as { success: boolean; data?: T; error?: string }
    if (!envelope.success) throw new ToolFailure(envelope.error || `${channel} failed`)
    return envelope.data as T
  }
  return result as T
}

export function truncate(value: string, limit = MAX_TEXT): string {
  if (value.length <= limit) return value
  return (
    value.slice(0, limit) +
    `\n\n[Truncated: ${value.length - limit} more characters. Narrow the request (fewer paths or a single file) to see the rest.]`
  )
}

export function toText(payload: unknown): CallToolResult {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null, null, 2)
  return { content: [{ type: 'text', text: truncate(body) }] }
}

export function toFailure(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

interface ToolConfig<S extends z.ZodRawShape> {
  title: string
  description: string
  inputSchema: S
}

type Args<S extends z.ZodRawShape> = z.objectOutputType<S, z.ZodTypeAny>

type LooseRegister = (
  name: string,
  config: Record<string, unknown>,
  callback: (args: never) => Promise<CallToolResult>
) => unknown

function register<S extends z.ZodRawShape>(
  ctx: ToolContext,
  name: string,
  config: ToolConfig<S>,
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean },
  handler: (args: Args<S>) => Promise<unknown>,
  onSuccess?: () => void
): void {
  const callback = async (args: Args<S>): Promise<CallToolResult> => {
    try {
      const result = await handler(args)
      onSuccess?.()
      return toText(result)
    } catch (error) {
      return toFailure((error as Error).message || String(error))
    }
  }
  const registerTool = ctx.server.registerTool.bind(ctx.server) as unknown as LooseRegister
  registerTool(name, { ...config, annotations: { title: config.title, ...annotations } }, callback)
}

export function readTool<S extends z.ZodRawShape>(
  ctx: ToolContext,
  name: string,
  config: ToolConfig<S>,
  handler: (args: Args<S>) => Promise<unknown>,
  options: { openWorld?: boolean } = {}
): void {
  register(ctx, name, config, { readOnlyHint: true, openWorldHint: options.openWorld ?? false }, handler)
}

export function writeTool<S extends z.ZodRawShape>(
  ctx: ToolContext,
  name: string,
  config: ToolConfig<S>,
  handler: (args: Args<S>) => Promise<unknown>,
  options: { destructive?: boolean; idempotent?: boolean; openWorld?: boolean } = {}
): void {
  if (ctx.readOnly) return
  register(
    ctx,
    name,
    config,
    {
      readOnlyHint: false,
      destructiveHint: options.destructive ?? false,
      idempotentHint: options.idempotent ?? false,
      openWorldHint: options.openWorld ?? false
    },
    handler,
    () => ctx.onWrite(name)
  )
}

interface TagRow {
  id: string
  name: string
  color: string
}

const DEFAULT_TAG_COLOR = '#6366f1'

export async function resolveTagIds(names: string[] | undefined, create = true): Promise<string[] | undefined> {
  if (!names) return undefined
  const tags = await call<TagRow[]>('tags:list')
  const ids: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const existing = tags.find((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      ids.push(existing.id)
    } else if (create) {
      const created = await call<TagRow>('tags:create', name, DEFAULT_TAG_COLOR)
      tags.push(created)
      ids.push(created.id)
    } else {
      throw new ToolFailure(`Unknown tag: ${name}`)
    }
  }
  return ids
}

export const tagNames = (tags: Array<{ name: string }> | undefined): string[] =>
  (tags ?? []).map((t) => t.name)
