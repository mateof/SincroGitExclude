import { kbHandle } from './kb-handlers'
import { rejectRemote } from './kb-sync-handlers'
import type { KbRepoService } from '../kb/kb-repo-service'
import type { KbRepoLinkInput } from '../../shared/kb/types'

export function registerKbRepoHandlers(repos: KbRepoService): void {
  kbHandle('kb:repo-link-preview', (_e, input: KbRepoLinkInput) => repos.preview(input))
  kbHandle('kb:repo-link', (e, input: KbRepoLinkInput) => {
    rejectRemote(e, 'Writing files into a repository')
    return repos.link(input)
  })
  kbHandle('kb:repo-unlink', (e, repoId: string, options?: { forgetInVault?: boolean }) => {
    rejectRemote(e, 'Removing files from a repository')
    return repos.unlink(repoId, options ?? {})
  })
  kbHandle('kb:repo-link-get', (_e, repoId: string) => repos.get(repoId))
  kbHandle('kb:repo-links', () => repos.list())
  kbHandle('kb:repo-suggestions', () => repos.suggestions())
  kbHandle('kb:repo-context', (_e, repoPath: string) => repos.context(repoPath))
}
