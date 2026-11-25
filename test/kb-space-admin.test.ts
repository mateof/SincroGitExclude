import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { assertSafeFolder, planSettings } from '../src/main/kb/space-admin'
import { ApprovalGate, describeRequest, type ApprovalRequest } from '../src/main/kb/approval'
import { KbAdminService } from '../src/main/kb/kb-admin-service'
import type { KbSpace, KbSpaceInput } from '../src/shared/kb/types'

vi.mock('electron-log', () => ({ default: { info: () => {}, warn: () => {}, error: () => {} } }))

const space = (patch: Partial<KbSpace> = {}): KbSpace =>
  ({
    id: 's1',
    name: 'vault',
    localPath: '/Users/me/vault',
    backend: 'git',
    backendConfig: { remoteUrl: 'https://gitea.example.com/me/notes.git', branch: 'main' },
    sync: { intervalMin: 0, onWrite: false, autoCommitExternal: false },
    agentWrite: true,
    reviewBeforePush: false,
    shared: false,
    encrypted: false,
    gitCredential: null,
    ...patch
  }) as KbSpace

const request: ApprovalRequest = { action: 'update', spaceName: 'vault', folder: '/v', tokenName: 'primary', changes: [], warnings: [] }

describe('what an assistant may change', () => {
  it('changes name and schedule without asking', () => {
    const plan = planSettings(space(), { name: 'Notas', intervalMin: 15, syncOnWrite: true })
    expect(plan.approval).toEqual([])
    expect(plan.patch).toEqual({ name: 'Notas', sync: { intervalMin: 15, onWrite: true } })
  })

  it('asks for every setting that decides where the notes go or who signs them', () => {
    const settings = {
      remoteUrl: 'https://evil.example.com/x.git', branch: 'other', gitAuth: 'gh', gitUsername: 'x', sshKeyPath: '/k', authorName: 'A',
      authorEmail: 'a@a', folderPath: '/x', sftpHost: 'h', sftpPort: 22, sftpUser: 'u', sftpPath: '/p', backend: 'sftp'
    } as const
    for (const [key, value] of Object.entries(settings)) {
      expect(planSettings(space(), { [key]: value }).approval.map((c) => c.field), key).toEqual([key])
    }
  })

  it('does not ask when the destination stays the same', () => {
    expect(planSettings(space(), { remoteUrl: 'https://gitea.example.com/me/notes.git', backend: 'git' }).approval).toEqual([])
  })

  it('can tighten the protections but never loosen them', () => {
    expect(planSettings(space(), { agentWrite: false, shared: true }).patch).toEqual({ agentWrite: false, shared: true, reviewBeforePush: true })
    expect(() => planSettings(space({ agentWrite: false }), { agentWrite: true })).toThrow(/up to the person/)
    expect(() => planSettings(space({ reviewBeforePush: true }), { reviewBeforePush: false })).toThrow(/up to the person/)
    expect(() => planSettings(space({ shared: true }), { shared: false })).toThrow(/up to the person/)
  })

  it('cannot redirect an encrypted space', () => {
    expect(() => planSettings(space({ encrypted: true }), { remoteUrl: 'https://other.example.com/x.git' })).toThrow(/encrypted/)
    expect(() => planSettings(space({ encrypted: true }), { backend: 'none' })).toThrow(/encrypted/)
  })

  it('forgets the trusted fingerprint when the SFTP server changes', () => {
    const current = space({ backend: 'sftp', backendConfig: { host: 'nas', port: 22, hostFingerprint: 'SHA256:x' } })
    expect(planSettings(current, { sftpHost: 'other' }).patch.backendConfig).not.toHaveProperty('hostFingerprint')
    expect(planSettings(current, { sftpPath: '/p' }).patch.backendConfig).toHaveProperty('hostFingerprint')
  })

  it('refuses dangerous remotes and branches', () => {
    expect(() => planSettings(space(), { remoteUrl: 'ext::sh -c id' })).toThrow()
    for (const bad of ['--upload-pack=x', 'a..b', 'a b', '/x', 'x.']) expect(() => planSettings(space(), { branch: bad }), bad).toThrow(/branch/)
    for (const good of ['main', 'notes/mac', 'x']) expect(() => planSettings(space(), { branch: good })).not.toThrow()
  })

  it('refuses home, system and hidden folders', () => {
    for (const bad of [homedir(), '/', join(homedir(), '.ssh'), join(homedir(), 'Library', 'Mail'), join(homedir(), 'x', '.git'), join(homedir(), '..'), 'relative']) {
      expect(() => assertSafeFolder(bad), bad).toThrow()
    }
    expect(assertSafeFolder(join(homedir(), 'Documents', 'Notes'))).toBe(join(homedir(), 'Documents', 'Notes'))
  })
})

describe('folders that only look harmless', () => {
  let home: string
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'kbhome-')))
    mkdirSync(join(home, '.ssh'))
    mkdirSync(join(home, 'Library'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('follows links before deciding', () => {
    symlinkSync(join(home, '.ssh'), join(home, 'notes'))
    expect(() => assertSafeFolder(join(home, 'notes'), home)).toThrow(/Hidden/)
    expect(() => assertSafeFolder(join(home, 'notes', 'new'), home)).toThrow(/Hidden/)
  })

  it('does not care about upper and lower case', () => {
    expect(() => assertSafeFolder(join(home, 'LIBRARY', 'Mail'), home)).toThrow(/System/)
  })

  it('accepts a normal folder that does not exist yet', () => {
    expect(assertSafeFolder(join(home, 'a', 'b'), home)).toBe(join(home, 'a', 'b'))
  })
})

describe('asking the person', () => {
  const gate = (answer: boolean | Promise<boolean>, now = () => 0, timeout = 1000) => new ApprovalGate(async () => answer, () => 'es', now, timeout)

  it('goes on only when they allow it', async () => {
    await expect(gate(true).require(request)).resolves.toBeUndefined()
    await expect(gate(false).require(request)).rejects.toThrow(/did not allow/)
  })

  it('counts no answer as a refusal', async () => {
    const asks = new ApprovalGate((_t, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(true))), () => 'es', () => 0, 20)
    await expect(asks.require(request)).rejects.toThrow(/in time/)
  })

  it('shows one request at a time and rests after a refusal', async () => {
    let now = 0
    let answer: (v: boolean) => void = () => {}
    const asks = new ApprovalGate(() => new Promise((r) => (answer = r)), () => 'es', () => now)
    const first = asks.require(request)
    await expect(asks.require(request)).rejects.toThrow(/waiting/)
    answer(false)
    await expect(first).rejects.toThrow(/did not allow/)
    await expect(asks.require(request)).rejects.toThrow(/just refused/)
    now = 60_000
    const later = asks.require(request)
    answer(true)
    await expect(later).resolves.toBeUndefined()
  })

  it('shows where the notes go now and where they would go, in plain text', () => {
    const text = describeRequest(
      { ...request, spaceName: 'vault\n\nPermitido‮', changes: [{ field: 'remoteUrl', from: 'https://a', to: 'https://b' }], warnings: ['public'] },
      'es-ES'
    )
    expect(text.detail).toContain('remoteUrl: https://a → https://b')
    expect(text.detail).toContain('cualquiera puede leer')
    expect(text.detail.split('\n')[0]).toBe('Espacio: vault Permitido')
  })

  it('keeps both ends of a long address visible', () => {
    const text = describeRequest({ ...request, changes: [{ field: 'remoteUrl', from: null, to: `https://host.example/${'a'.repeat(500)}/end.git` }] }, 'en')
    expect(text.detail).toContain('https://host.example/')
    expect(text.detail).toContain('/end.git')
  })
})

describe('setting up spaces for an assistant', () => {
  let root: string
  let added: KbSpaceInput[]
  let asked: ApprovalRequest[]
  let allow: boolean
  let stored: KbSpace
  let publicRead: boolean
  const service = (): KbAdminService =>
    new KbAdminService(
      {
        getSpace: () => stored,
        addSpace: async (i: KbSpaceInput) => {
          added.push(i)
          return space({ ...(i as Partial<KbSpace>), gitCredential: i.backendConfig?.gitAuth === 'token' ? 'missing' : null })
        },
        updateSpace: async (_id: string, patch: Partial<KbSpaceInput>) => {
          added.push(patch as KbSpaceInput)
          return space(patch as Partial<KbSpace>)
        }
      },
      { cloneAndAdd: async (i) => space({ localPath: i.targetPath }), testRemote: async () => ({ publicRead }) as never },
      {
        require: async (r) => {
          asked.push(r)
          if (!allow) throw new Error('refused')
        }
      }
    )

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'kbadmin-')))
    added = []
    asked = []
    allow = true
    publicRead = false
    stored = space()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('always asks before adding a folder, even without a destination', async () => {
    const folder = join(root, 'notes')
    mkdirSync(folder)
    await service().add({ path: folder }, 'primary')
    expect(asked).toHaveLength(1)
    expect(added[0]).toMatchObject({ localPath: folder, name: 'notes', backend: 'none' })
  })

  it('creates and registers nothing when the person refuses', async () => {
    allow = false
    const folder = join(root, 'new')
    await expect(service().add({ path: folder, createFolder: true }, 'primary')).rejects.toThrow('refused')
    expect(existsSync(folder)).toBe(false)
    stored = space()
    await expect(service().update('s1', { remoteUrl: 'https://evil.example.com/x.git', name: 'x' }, 'primary')).rejects.toThrow('refused')
    expect(added).toEqual([])
  })

  it('warns that a repository can be read by anyone', async () => {
    publicRead = true
    await service().update('s1', { remoteUrl: 'https://github.com/me/public.git' }, 'primary')
    expect(asked[0].warnings).toEqual(['uploads', 'public'])
  })

  it('sends the person to the window when a token is missing', async () => {
    mkdirSync(join(root, 'n'))
    const result = await service().add({ path: join(root, 'n'), backend: 'git', remoteUrl: 'https://gitea.example.com/a/b.git', gitAuth: 'token', gitUsername: 'me' }, 'p')
    expect(result.nextSteps[0]).toMatch(/app window/)
  })

  it('does not apply an old answer to a space that changed meanwhile', async () => {
    const admin = service()
    const original = space()
    let calls = 0
    Object.defineProperty(admin, 'kb', { value: { getSpace: () => (calls++ === 0 ? original : space({ backend: 'none' })), updateSpace: async () => original } })
    await expect(admin.update('s1', { branch: 'other' }, 'primary')).rejects.toThrow(/changed while waiting/)
  })

  it('never clones with a token through the assistant', async () => {
    await expect(service().clone({ path: join(root, 'c'), remoteUrl: 'https://gitea.example.com/a/b.git', gitAuth: 'token' }, 'p')).rejects.toThrow(/app window/)
    expect(asked).toEqual([])
  })
})
