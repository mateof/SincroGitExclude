import { ipcMain, shell } from 'electron'
import { existsSync, statSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { describeError, isCloudSyncedPath } from '../utils/errors'
import { isWebEvent } from './channel-registry'
import type { KbService } from '../kb/kb-service'
import { readSpaceMeta } from '../kb/space-meta'
import { resolveInSpace, normalizeRel } from '../kb/paths'
import type { KbOrigin, KbSearchOptions, KbSpaceInput } from '../../shared/kb/types'

type Envelope = { success: true; data?: unknown } | { success: false; error: string }

export function kbHandle(channel: string, fn: (event: unknown, ...args: never[]) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Envelope> => {
    try {
      const data = await (fn as (event: unknown, ...a: unknown[]) => unknown)(event, ...args)
      return { success: true, data }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  })
}

export function originOf(event: unknown, origin: KbOrigin | undefined): KbOrigin {
  if ((event as { __transport?: string } | null)?.__transport === 'mcp') {
    return { source: 'mcp', tokenName: origin?.tokenName, tool: origin?.tool }
  }
  if (isWebEvent(event)) return { source: 'web', tool: origin?.tool }
  return { source: 'ui', tool: origin?.tool }
}

export function registerKbHandlers(kb: KbService): void {
  kbHandle('kb:list-spaces', async () => {
    await kb.whenReady()
    return kb.listSpaces()
  })
  kbHandle('kb:get-space', (_e, id: string) => kb.getSpace(id))
  kbHandle('kb:add-space', (_e, input: KbSpaceInput) => kb.addSpace(input))
  kbHandle('kb:update-space', (_e, id: string, patch: Partial<KbSpaceInput>) => kb.updateSpace(id, patch))
  kbHandle('kb:remove-space', async (_e, id: string) => {
    await kb.removeSpace(id)
    return { removed: id }
  })
  kbHandle('kb:relocate-space', (_e, id: string, target: string) => kb.relocateSpace(id, target))
  kbHandle('kb:reindex', (_e, id: string) => kb.reindex(id))

  kbHandle('kb:check-path', (_e, path: string) => {
    if (!path || !isAbsolute(path)) return { exists: false, isDirectory: false, cloudSynced: false, spaceMeta: null, insideSpace: null }
    const full = resolve(path)
    const exists = existsSync(full)
    return {
      exists,
      isDirectory: exists && statSync(full).isDirectory(),
      cloudSynced: isCloudSyncedPath(full),
      spaceMeta: exists ? readSpaceMeta(full) : null,
      insideSpace: kb.relPathIfInsideSpace(full)
    }
  })

  kbHandle('kb:tree', (_e, id: string, includeFiles?: boolean) => kb.tree(id, includeFiles === true))
  kbHandle('kb:list-folder', (_e, id: string, folder: string) => kb.listFolder(id, folder))
  kbHandle('kb:note-view', (_e, id: string, path: string) => kb.noteView(id, path))
  kbHandle('kb:read-note', (_e, id: string, path: string) => kb.readRaw(id, path))
  kbHandle('kb:read-asset', (_e, id: string, fromPath: string, target: string) => kb.readAsset(id, fromPath, target))
  kbHandle('kb:resolve-link', (_e, id: string, fromPath: string, target: string) => kb.resolveLink(id, fromPath, target))
  kbHandle('kb:search', (_e, query: string, options?: KbSearchOptions) => kb.search(query, options ?? {}))
  kbHandle('kb:recent', (_e, options?: { spaceIds?: string[]; limit?: number; folder?: string }) => kb.recent(options ?? {}))
  kbHandle('kb:tags', (_e, spaceIds?: string[]) => kb.tags(spaceIds))

  kbHandle('kb:create-note', (e, id: string, path: string, content: string, origin?: KbOrigin) =>
    kb.createNote(id, path, content, originOf(e, origin))
  )
  kbHandle(
    'kb:replace-in-note',
    (e, id: string, path: string, oldText: string, newText: string, expectedHash: string, origin?: KbOrigin) =>
      kb.replaceInNote(id, path, oldText, newText, expectedHash, originOf(e, origin))
  )
  kbHandle('kb:append-note', (e, id: string, path: string, content: string, expectedHash: string, origin?: KbOrigin) =>
    kb.appendToNote(id, path, content, expectedHash, originOf(e, origin))
  )
  kbHandle(
    'kb:patch-section',
    (
      e,
      id: string,
      path: string,
      heading: string,
      content: string,
      mode: 'replace' | 'append' | 'prepend',
      expectedHash: string,
      origin?: KbOrigin
    ) => kb.patchSection(id, path, heading, content, mode, expectedHash, originOf(e, origin))
  )
  kbHandle(
    'kb:set-frontmatter',
    (e, id: string, path: string, patch: Record<string, unknown>, expectedHash: string, origin?: KbOrigin) =>
      kb.setFrontmatter(id, path, patch, expectedHash, originOf(e, origin))
  )
  kbHandle('kb:trash-note', (e, id: string, path: string, expectedHash: string, origin?: KbOrigin) =>
    kb.trashNote(id, path, expectedHash, originOf(e, origin))
  )

  kbHandle('kb:audit', (_e, spaceId: string | null, limit?: number) => kb.auditLog(spaceId, limit ?? 200))
  kbHandle('kb:review-list', (_e, spaceId: string) => kb.pendingReview(spaceId))
  kbHandle('kb:review-diff', (_e, spaceId: string, auditId: number) => kb.reviewDiff(spaceId, auditId))
  kbHandle('kb:review-approve', (e, spaceId: string, ids: number[] | 'all') => {
    if ((e as { __transport?: string } | null)?.__transport === 'mcp') {
      throw new Error('Approving assistant changes is up to the person, not the assistant')
    }
    return { approved: kb.approveReview(spaceId, ids) }
  })
  kbHandle('kb:review-revert', async (e, spaceId: string, auditId: number) => {
    if ((e as { __transport?: string } | null)?.__transport === 'mcp') {
      throw new Error('Reviewing assistant changes is up to the person, not the assistant')
    }
    await kb.revertReview(spaceId, auditId)
    return { reverted: auditId }
  })

  kbHandle('kb:open-in-obsidian', async (_e, id: string, path?: string) => {
    const root = kb.rootPathOf(id)
    const target = path ? resolveInSpace(root, normalizeRel(path)) : root
    await shell.openExternal(`obsidian://open?path=${encodeURIComponent(target)}`)
    return { opened: target.replace(/\\/g, '/') }
  })
  kbHandle('kb:show-in-folder', (_e, id: string, path?: string) => {
    const root = kb.rootPathOf(id)
    const target = path ? resolveInSpace(root, normalizeRel(path)) : root
    if (path) shell.showItemInFolder(target)
    else void shell.openPath(target)
    return { shown: target.replace(/\\/g, '/') }
  })
}
