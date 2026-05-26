import { describe, expect, it } from 'vitest'
import { isCommandIndexPath, isExcludedCommandPath } from './command-fs.js'

describe('isExcludedCommandPath', () => {
  it('excludes any path with an underscore-prefixed segment', () => {
    expect(isExcludedCommandPath('auth/_shared/foo.ts')).toBe(true)
    expect(isExcludedCommandPath('run/app/_strategies/index.ts')).toBe(true)
    expect(isExcludedCommandPath('auth/devices/_shared/util.ts')).toBe(true)
    expect(isExcludedCommandPath('_shared/index.ts')).toBe(true)
  })

  it('keeps regular paths', () => {
    expect(isExcludedCommandPath('auth/login/index.ts')).toBe(false)
    expect(isExcludedCommandPath('version/index.ts')).toBe(false)
  })

  it('normalizes backslashes', () => {
    expect(isExcludedCommandPath('run\\app\\_strategies\\index.ts')).toBe(true)
  })
})

describe('isCommandIndexPath', () => {
  it('accepts paths that end with /index.ts and contain no excluded segments', () => {
    expect(isCommandIndexPath('auth/login/index.ts')).toBe(true)
    expect(isCommandIndexPath('version/index.ts')).toBe(true)
  })

  it('rejects non-index.ts files', () => {
    expect(isCommandIndexPath('auth/login/util.ts')).toBe(false)
  })

  it('rejects excluded paths', () => {
    expect(isCommandIndexPath('_shared/index.ts')).toBe(false)
    expect(isCommandIndexPath('run/app/_strategies/index.ts')).toBe(false)
  })
})
