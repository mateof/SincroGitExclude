import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { matchesAnyPattern, scanDirectory, toGitignoreLines } from '../src/main/utils/file-scanner'
import { writeFile } from './helpers/git-fixture'

describe('ignore pattern matching', () => {
  it.each([
    ['dist/', 'dist/app.js', true],
    ['dist/', 'src/dist/app.js', true],
    ['dist/', 'distribution/app.js', false],
    ['*.log', 'deep/inside/debug.log', true],
    ['node_modules', 'node_modules/x/index.js', true],
    ['node_modules', 'pkg/node_modules/x/index.js', false],
    ['src/*.js', 'src/a.js', true],
    ['src/*.js', 'src/nested/a.js', false],
    ['**/build/', 'a/b/build/out.txt', true],
    ['# comment', '# comment', false]
  ])('pattern %s against %s is %s', (pattern, path, expected) => {
    expect(matchesAnyPattern(path, [pattern])).toBe(expected)
  })
})

describe('gitignore translation used to let git prune ignored folders', () => {
  it('anchors plain names to the root the way the app matcher does', () => {
    expect(toGitignoreLines(['node_modules', 'dist/', '*.log', 'src/*.js', '**/build/'])).toEqual([
      '.svn/',
      '.hg/',
      '/node_modules',
      'dist/',
      '*.log',
      '/src/*.js',
      '**/build/'
    ])
  })

  it('escapes a leading bang so git does not read it as a negation', () => {
    expect(toGitignoreLines(['!important'])).toContain('/\\!important')
  })

  it('drops comments and root-anchored patterns the app matcher never matches', () => {
    expect(toGitignoreLines(['# note', '/abs', '  '])).toEqual(['.svn/', '.hg/'])
  })
})

describe('directory scanning', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('returns paths relative to the base even when starting from a subfolder', () => {
    root = mkdtempSync(join(tmpdir(), 'sge-scan-'))
    writeFile(root, 'a/b/c.txt', 'x')
    writeFile(root, 'a/b/skip.log', 'x')
    writeFile(root, 'other.txt', 'x')

    expect(scanDirectory(root, ['*.log'], join(root, 'a'))).toEqual(['a/b/c.txt'])
  })
})
