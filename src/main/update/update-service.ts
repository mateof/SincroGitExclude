import { app, net } from 'electron'
import log from 'electron-log'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { pushEvent } from '../events'
import type { UpdateCapability, UpdateState } from '../../shared/update-types'
import { downloadAsset, type FetchLike } from './download'
import { bundlePathOf, createStageDir, removeAppTree, removeStaleStages, stageFromImage, updateBlocker } from './mac-bundle'
import { assertNewerVersion, releaseApiUrl, selectMacAsset, type GithubRelease } from './release'
import { spawnSwap } from './swap'

const PROGRESS_INTERVAL_MS = 200
const IDLE: UpdateState = { phase: 'idle', version: null, received: 0, total: 0, installFailed: false }

export class UpdateService {
  private state: UpdateState = IDLE
  private staged: string | null = null
  private stageDir: string | null = null
  private abort: AbortController | null = null
  private readonly fetcher: FetchLike = (url, init) => net.fetch(url, init)

  capability(): UpdateCapability {
    const blocker = updateBlocker({ platform: process.platform, packaged: app.isPackaged, execPath: process.execPath })
    return { supported: blocker === null, blocker }
  }

  current(): UpdateState {
    if (existsSync(this.failureFile())) {
      rmSync(this.failureFile(), { force: true })
      log.warn('The last update could not replace the app')
      this.state = { ...this.state, installFailed: true }
    }
    return this.state
  }

  async download(version: string): Promise<UpdateState> {
    const { blocker } = this.capability()
    const bundle = bundlePathOf(process.execPath)
    if (blocker || !bundle) throw new Error(`The app cannot update itself here (${blocker ?? 'development'})`)
    if (this.state.phase === 'ready' && this.state.version === version) return this.state
    if (this.state.phase !== 'idle' && this.state.phase !== 'ready') throw new Error('An update is already in progress')
    assertNewerVersion(app.getVersion(), version)

    this.discardStage()
    const abort = new AbortController()
    this.abort = abort
    this.setState({ ...IDLE, phase: 'downloading', version })
    const work = mkdtempSync(join(app.getPath('temp'), 'sge-update-'))
    try {
      const arch = app.runningUnderARM64Translation ? 'arm64' : process.arch
      const asset = selectMacAsset(await this.fetchRelease(version, abort.signal), version, arch)
      const image = join(work, 'update.dmg')
      let last = 0
      await downloadAsset(this.fetcher, asset, image, abort.signal, (received) => {
        const now = Date.now()
        if (now - last < PROGRESS_INTERVAL_MS && received < asset.size) return
        last = now
        this.setState({ ...IDLE, phase: 'downloading', version, received, total: asset.size })
      })
      this.setState({ ...IDLE, phase: 'verifying', version, received: asset.size, total: asset.size })
      removeStaleStages(bundle)
      this.stageDir = createStageDir(bundle)
      const mountPoint = join(work, 'mount')
      mkdirSync(mountPoint)
      const staged = await stageFromImage(image, this.stageDir, mountPoint, { version, arch })
      abort.signal.throwIfAborted()
      this.staged = staged
      this.setState({ ...IDLE, phase: 'ready', version, received: asset.size, total: asset.size })
      log.info(`Update ${version} verified and ready to install`)
      return this.state
    } catch (error) {
      this.discardStage()
      this.setState(IDLE)
      if (abort.signal.aborted) return this.state
      throw error
    } finally {
      this.abort = null
      rmSync(work, { recursive: true, force: true })
    }
  }

  cancel(): UpdateState {
    this.abort?.abort()
    return this.state
  }

  install(): UpdateState {
    const target = bundlePathOf(process.execPath)
    if (this.state.phase !== 'ready' || !this.staged || !target) throw new Error('There is no update ready to install')
    log.info(`Installing update ${this.state.version}`)
    rmSync(this.failureFile(), { force: true })
    spawnSwap({ pid: process.pid, target, staged: this.staged, failureFile: this.failureFile() })
    this.setState({ ...this.state, phase: 'installing' })
    setTimeout(() => app.quit(), 300)
    return this.state
  }

  dispose(): void {
    if (this.state.phase === 'installing') return
    this.abort?.abort()
    this.discardStage()
  }

  private async fetchRelease(version: string, signal: AbortSignal): Promise<GithubRelease> {
    const response = await this.fetcher(releaseApiUrl(version), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) throw new Error(`Could not read the release (HTTP ${response.status})`)
    return (await response.json()) as GithubRelease
  }

  private failureFile(): string {
    return join(app.getPath('userData'), 'update-failed')
  }

  private discardStage(): void {
    const dir = this.stageDir
    this.stageDir = null
    this.staged = null
    if (!dir) return
    try {
      removeAppTree(dir)
    } catch (error) {
      log.warn('Could not remove the downloaded update:', error)
    }
  }

  private setState(state: UpdateState): void {
    this.state = state
    pushEvent('update:state', state)
  }
}
