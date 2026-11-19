import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const { buildIgnoreMatcher } = await import('../src/main/services/watcher-service')

describe('watcher ignore matcher', () => {
  const root = join('/repo', 'bundle')
  const ignored = buildIgnoreMatcher(root, ['node_modules/', '*.log', 'build'])

  it('prunes ignored directories before chokidar descends into them', () => {
    expect(ignored(join(root, 'node_modules'))).toBe(true)
    expect(ignored(join(root, 'pkg', 'node_modules', 'x', 'index.js'))).toBe(true)
    expect(ignored(join(root, 'build'))).toBe(true)
  })

  it('skips version control folders even without user patterns', () => {
    expect(buildIgnoreMatcher(root, [])(join(root, 'sub', '.git', 'HEAD'))).toBe(true)
  })

  it('keeps watching regular files and the root itself', () => {
    expect(ignored(root)).toBe(false)
    expect(ignored(join(root, 'config', 'app.json'))).toBe(false)
    expect(ignored(join(root, 'debug.log'))).toBe(true)
  })
})
