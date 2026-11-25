import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createFixture, git, writeFile, type Fixture } from './helpers/git-fixture'
import { startGitHttpServer, type GitHttpServer } from './helpers/git-http-server'
import { cloneSpace, ensureRepo, syncGitSpace } from '../src/main/kb/sync/git-space'
import { GitMirrorStore } from '../src/main/kb/sync/git-mirror-store'
import { classifyGitError, probeRemote, sshKeyAuth, tokenAuth } from '../src/main/kb/sync/git-auth'
import { canSendToken, detectProvider, parseRemote, tokenPageUrl } from '../src/shared/kb/git-remote'

const credential = { username: 'mateo', token: 'secret-token-123' }
let fx: Fixture
let server: GitHttpServer
let url: string
let vault: string
const servers: GitHttpServer[] = []

const start = async (...args: Parameters<typeof startGitHttpServer>): Promise<GitHttpServer> => {
  const s = await startGitHttpServer(...args)
  servers.push(s)
  return s
}
const auth = (c = credential) => tokenAuth(parseRemote(url), c)
const opts = (a?: ReturnType<typeof auth>) => ({ branch: 'main', machineName: 'mac', blockSecrets: false, auth: a })

beforeEach(async () => {
  fx = createFixture()
  const bare = join(fx.root, 'srv', 'notes.git')
  mkdirSync(bare, { recursive: true })
  await git(bare, 'init', '-q', '--bare', '-b', 'main')
  await git(bare, 'config', 'http.receivepack', 'true')
  server = await start(join(fx.root, 'srv'), credential)
  url = `${server.origin}/notes.git`
  vault = join(fx.root, 'vault')
  mkdirSync(vault)
  writeFile(vault, 'README.md', '# Mi vault\n')
  writeFile(vault, 'projects/app.md', '# App\n')
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  fx.cleanup()
})

function everyFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everyFile(join(dir, e.name)) : [join(dir, e.name)]))
}

describe('a private repository with user and token', () => {
  it('pushes and clones, and leaves the token nowhere on disk', async () => {
    await ensureRepo(vault, url, 'main')
    const report = await syncGitSpace(vault, opts(auth()))
    expect(report.message).toBeNull()
    expect(report.pushed).toContain('projects/app.md')
    const other = join(fx.root, 'other')
    await cloneSpace(url, other, 'main', auth())
    expect(readFileSync(join(other, 'projects/app.md'), 'utf-8')).toBe('# App\n')
    const leaked = [...everyFile(vault), ...everyFile(other)].filter((f) => readFileSync(f).includes(credential.token))
    expect(leaked).toEqual([])
  })

  it('works for the encrypted mirror too', async () => {
    const store = new GitMirrorStore(join(fx.root, 'mirror'), url, 'main', auth())
    await store.open()
    await store.write('format.json', Buffer.from('{}'))
    await store.commit()
    expect((await probeRemote(url, auth())).branches).toEqual(['main'])
  })

  it('explains a wrong token instead of a raw git error', async () => {
    await ensureRepo(vault, url, 'main')
    const report = await syncGitSpace(vault, opts(auth({ username: 'mateo', token: 'wrong' })))
    expect(report.ok).toBe(false)
    expect(report.message).toMatch(/did not accept the credentials/)
    expect(report.message).not.toContain('wrong')
  })

  it('keeps the notes committed here when there are no credentials', async () => {
    await ensureRepo(vault, url, 'main')
    const report = await syncGitSpace(vault, opts())
    expect(report.ok).toBe(false)
    expect(await git(vault, 'ls-tree', '-r', '--name-only', 'HEAD')).toContain('projects/app.md')
  })

  it('does not hand the token to another server', async () => {
    const thief = await start(join(fx.root, 'srv'), { username: 'x', token: 'y' })
    await ensureRepo(vault, `${thief.origin}/notes.git`, 'main')
    await syncGitSpace(vault, opts(auth()))
    expect(thief.seen).toEqual([])
  })

  it('does not hand the token to the server of a redirect', async () => {
    const thief = await start(join(fx.root, 'srv'), { username: 'x', token: 'y' })
    const redirecting = await start(join(fx.root, 'srv'), null, thief.origin)
    const from = `${redirecting.origin}/notes.git`
    await ensureRepo(vault, from, 'main')
    await syncGitSpace(vault, opts(tokenAuth(parseRemote(from), credential)))
    expect(thief.seen).toEqual([])
  })

  it('ignores the credential helpers of the computer when a token is set', async () => {
    writeFileSync(fx.globalConfig, `[credential]\n\thelper = "!f() { echo username=work; echo password=work; }; f"\n`)
    expect((await probeRemote(url, auth())).ok).toBe(true)
    expect(server.seen.some((h) => Buffer.from(h.slice(6), 'base64').toString().startsWith('work:'))).toBe(false)
  })
})

describe('checking a remote', () => {
  it('tells a private repository from one anyone can read', async () => {
    expect((await probeRemote(url, auth())).publicRead).toBe(false)
    const open = await start(join(fx.root, 'srv'), null)
    expect((await probeRemote(`${open.origin}/notes.git`, undefined)).publicRead).toBe(true)
  })

  it('does not call public a repository the credentials of the computer can open', async () => {
    writeFileSync(fx.globalConfig, `[credential]\n\thelper = "!f() { echo username=mateo; echo password=secret-token-123; }; f"\n`)
    const probe = await probeRemote(url, undefined)
    expect(probe.ok).toBe(true)
    expect(probe.publicRead).toBe(false)
  })

  it('says whether it is empty and which branches it has', async () => {
    expect(await probeRemote(url, auth())).toMatchObject({ ok: true, empty: true, branches: [] })
    await ensureRepo(vault, url, 'main')
    await syncGitSpace(vault, opts(auth()))
    expect(await probeRemote(url, auth())).toMatchObject({ ok: true, empty: false, branches: ['main'], defaultBranch: 'main' })
  })

  it('reports rejected credentials as an authentication problem', async () => {
    expect(await probeRemote(url, undefined)).toMatchObject({ ok: false, problem: 'auth' })
  })
})

describe('linking a vault to a repository that only has the first commit of the server', () => {
  const seed = async (files: Record<string, string>): Promise<void> => {
    const tmp = join(fx.root, 'seed')
    mkdirSync(tmp)
    await git(tmp, 'init', '-q', '-b', 'main')
    await git(tmp, 'config', 'user.email', 's@s')
    await git(tmp, 'config', 'user.name', 'Server')
    for (const [path, content] of Object.entries(files)) writeFile(tmp, path, content)
    await git(tmp, 'add', '-A')
    await git(tmp, 'commit', '-q', '-m', 'Initial commit')
    await git(tmp, 'push', '-q', join(fx.root, 'srv', 'notes.git'), 'HEAD:refs/heads/main')
  }

  it('keeps the README of the vault without a conflict copy and adds the LICENSE', async () => {
    await seed({ 'README.md': '# notes\n', LICENSE: 'MIT\n' })
    await ensureRepo(vault, url, 'main')
    const report = await syncGitSpace(vault, opts(auth()))
    expect(report).toMatchObject({ ok: true, conflicts: [] })
    expect(readFileSync(join(vault, 'README.md'), 'utf-8')).toBe('# Mi vault\n')
    expect(readFileSync(join(vault, 'LICENSE'), 'utf-8')).toBe('MIT\n')
    expect((await git(vault, 'rev-list', '--count', 'HEAD')).trim()).toBe('2')
    expect((await git(vault, 'show', 'HEAD~1:README.md')).trim()).toBe('# notes')
  })

  it('keeps both versions when the remote already has real notes', async () => {
    await seed({ 'README.md': '# notes\n', 'projects/app.md': '# Other app\n' })
    await ensureRepo(vault, url, 'main')
    const report = await syncGitSpace(vault, opts(auth()))
    expect(report.conflicts.length).toBeGreaterThan(0)
    expect(readFileSync(join(vault, 'projects/app.md'), 'utf-8')).toBe('# Other app\n')
  })

  it('signs the commits with the identity of the space', async () => {
    writeFileSync(fx.globalConfig, '[user]\n\tname = Work\n\temail = work@company.test\n')
    await ensureRepo(vault, url, 'main', [], { name: 'Mateo', email: 'me@home.test' })
    await syncGitSpace(vault, opts(auth()))
    expect(await git(vault, 'log', '-1', '--format=%an %ae %ce')).toBe('Mateo me@home.test me@home.test')
  })
})

describe('which remotes are accepted', () => {
  it('refuses remotes that could run commands or carry a token', () => {
    for (const bad of ['', '--upload-pack=x', 'ext::sh -c id', 'git://host/x', 'https://u:token@host/x', 'ssh://-oProxyCommand=x/y', 'https://host/a\nb']) {
      expect(() => parseRemote(bad), bad).toThrow()
    }
  })

  it('understands https, ssh, scp-like and local remotes', () => {
    expect(parseRemote('https://gitea.example.com:3000/a/b.git')).toMatchObject({ kind: 'http', origin: 'https://gitea.example.com:3000' })
    expect(parseRemote('git@gitlab.com:a/b.git')).toMatchObject({ kind: 'ssh', host: 'gitlab.com' })
    expect(parseRemote('ssh://git@host:2222/a.git')).toMatchObject({ kind: 'ssh', host: 'host' })
    expect(parseRemote('/srv/notes.git').kind).toBe('local')
    expect(parseRemote('C:\\notes.git').kind).toBe('local')
  })

  it('never sends a token unencrypted over the internet', () => {
    expect(canSendToken(parseRemote('https://host.example.com/a'))).toBe(true)
    expect(canSendToken(parseRemote('http://192.168.0.22:21080/a'))).toBe(true)
    for (const open of ['http://host.example.com/a', 'http://8.8.8.8/a', 'http://[2001:db8::1]/a', 'http://192.168.0.22.example.com/a']) {
      expect(canSendToken(parseRemote(open)), open).toBe(false)
      expect(() => tokenAuth(parseRemote(open), credential)).toThrow(/unencrypted/)
    }
  })

  it('knows where each service creates its tokens', () => {
    expect(detectProvider('gitea.mateof.com.es')).toBe('gitea')
    expect(detectProvider('gitlab.com')).toBe('gitlab')
    expect(detectProvider('github.com')).toBe('github')
    expect(tokenPageUrl('gitea', 'https://g.example')).toBe('https://g.example/user/settings/applications')
  })

  it('classifies the errors of GitHub, GitLab and Gitea', () => {
    expect(classifyGitError('remote: Invalid username or token.\nfatal: Authentication failed')).toBe('auth')
    expect(classifyGitError("fatal: could not read Username for 'https://x': terminal prompts disabled")).toBe('auth')
    expect(classifyGitError('remote: Repository not found.')).toBe('not-found')
    expect(classifyGitError('fatal: unable to access: Could not resolve host: x')).toBe('network')
  })

  it('refuses an ssh key that does not exist and quotes the path of one that does', () => {
    expect(() => sshKeyAuth('/missing/key')).toThrow(/does not exist/)
    const key = join(fx.root, "my 'key")
    writeFileSync(key, '')
    expect(sshKeyAuth(key).env.GIT_SSH_COMMAND).toContain(`'\\''key'`)
    expect(existsSync(key)).toBe(true)
  })
})
