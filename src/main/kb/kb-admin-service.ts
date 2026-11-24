import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { basename } from 'path'
import { pushEvent } from '../events'
import { parseRemote } from '../../shared/kb/git-remote'
import type { KbBackendConfig, KbSpace } from '../../shared/kb/types'
import type { ApprovalGate, ApprovalWarning } from './approval'
import type { KbService } from './kb-service'
import type { KbSyncService } from './kb-sync-service'
import { assertSafeFolder, planSettings, type SpaceSettings } from './space-admin'

export interface AdminResult {
  space: KbSpace
  nextSteps: string[]
}

export class KbAdminService {
  constructor(
    private readonly kb: Pick<KbService, 'getSpace' | 'addSpace' | 'updateSpace'>,
    private readonly sync: Pick<KbSyncService, 'cloneAndAdd' | 'testRemote'>,
    private readonly gate: Pick<ApprovalGate, 'require'>
  ) {}

  async add(input: SpaceSettings & { path: string; createFolder?: boolean }, tokenName: string): Promise<AdminResult> {
    const folder = assertSafeFolder(input.path)
    const exists = existsSync(folder)
    if (exists && !statSync(folder).isDirectory()) throw new Error(`Not a folder: ${folder}`)
    if (!exists && !input.createFolder) throw new Error(`The folder does not exist: ${folder}. Pass createFolder to create it.`)
    const { patch, approval } = planSettings(null, { ...input, backend: input.backend ?? 'none' })
    const warnings = await this.warnings(patch.backendConfig, input.backend)
    if (!exists) warnings.push('creates')
    const name = input.name?.trim() || basename(folder)
    await this.gate.require({ action: 'add', spaceName: name, folder, tokenName, changes: approval, warnings })
    if (!exists) mkdirSync(folder, { recursive: true })
    return this.done(await this.kb.addSpace({ ...patch, name, localPath: folder }))
  }

  async clone(input: SpaceSettings & { path: string; remoteUrl: string }, tokenName: string): Promise<AdminResult> {
    const folder = assertSafeFolder(input.path)
    if (existsSync(folder) && readdirSync(folder).length > 0) throw new Error(`The destination is not empty: ${folder}`)
    if (input.gitAuth === 'token') {
      throw new Error('A private repository with a token is cloned from the app window, so the token never goes through the assistant')
    }
    const { patch, approval } = planSettings(null, { ...input, backend: 'git' })
    const name = input.name?.trim() || basename(folder)
    const config = { ...patch.backendConfig, remoteUrl: input.remoteUrl }
    await this.gate.require({ action: 'clone', spaceName: name, folder, tokenName, changes: approval, warnings: await this.warnings(config, 'git') })
    return this.done(await this.sync.cloneAndAdd({ ...config, targetPath: folder, name }))
  }

  async update(spaceId: string, settings: SpaceSettings, tokenName: string): Promise<AdminResult> {
    const current = this.kb.getSpace(spaceId)
    const { patch, approval } = planSettings(current, settings)
    if (approval.length > 0) {
      const warnings = await this.warnings(patch.backendConfig ?? current.backendConfig, patch.backend ?? current.backend)
      await this.gate.require({ action: 'update', spaceName: current.name, folder: current.localPath, tokenName, changes: approval, warnings })
      const now = this.kb.getSpace(spaceId)
      if (JSON.stringify([now.backend, now.backendConfig, now.encrypted]) !== JSON.stringify([current.backend, current.backendConfig, current.encrypted])) {
        throw new Error('The space changed while waiting for the person. Read it again with kb_status.')
      }
    }
    return this.done(await this.kb.updateSpace(spaceId, patch))
  }

  private async warnings(config: KbBackendConfig | undefined, backend: string | undefined): Promise<ApprovalWarning[]> {
    if (!backend || backend === 'none') return []
    const out: ApprovalWarning[] = ['uploads']
    if (backend === 'git' && config?.remoteUrl && parseRemote(config.remoteUrl).kind === 'http') {
      const probe = await this.sync.testRemote({ remoteUrl: config.remoteUrl }).catch(() => null)
      if (probe?.publicRead) out.push('public')
    }
    return out
  }

  private done(space: KbSpace): AdminResult {
    const nextSteps: string[] = []
    if (space.gitCredential === 'missing') {
      pushEvent('kb:open-space-settings', { spaceId: space.id })
      nextSteps.push('The person has to write the token of the repository in the space settings, which are now open in the app window. Never ask for it in the chat.')
    }
    if (space.backend === 'sftp' && !space.backendConfig.hostFingerprint) {
      nextSteps.push('The person has to confirm the server fingerprint in the space settings.')
    }
    if (space.backend !== 'none') nextSteps.push('Check the connection with kb_test_space and then use kb_sync.')
    pushEvent('kb:changed', { spaceId: space.id, paths: [] })
    return { space, nextSteps }
  }
}
