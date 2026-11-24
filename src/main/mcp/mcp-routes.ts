import type { McpGetRoute } from './mcp-app'
import { canAccessSpace } from './mcp-grants'

export type KbNoteProvider = (spaceId: string, notePath: string) => Promise<string>

let provider: KbNoteProvider | null = null

export function setKbNoteProvider(next: KbNoteProvider): void {
  provider = next
}

export function mcpGetRoutes(): McpGetRoute[] {
  return [
    {
      path: '/kb/context',
      handler: async (req, res, grant) => {
        const space = typeof req.query.space === 'string' ? req.query.space : ''
        const note = typeof req.query.note === 'string' ? req.query.note : ''
        if (!grant.scopes.has('kb:read') && !grant.scopes.has('kb:write')) {
          res.status(403).type('text/plain').send('This token cannot read the knowledge base')
          return
        }
        if (!space || !note || !canAccessSpace(grant, space)) {
          res.status(404).type('text/plain').send('Note not found')
          return
        }
        if (!provider) {
          res.status(503).type('text/plain').send('The knowledge base is not ready')
          return
        }
        try {
          res.type('text/markdown; charset=utf-8').send(await provider(space, note))
        } catch {
          res.status(404).type('text/plain').send('Note not found')
        }
      }
    }
  ]
}
