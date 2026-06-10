import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePlatform, SUBDIR } from './index'

describe('resolvePlatform', () => {
  it('id matches process.platform', () => {
    expect(resolvePlatform().id()).toBe(process.platform)
  })

  it('configDir ends with the difyctl subdir', () => {
    const p = resolvePlatform()
    if (p.id() === 'win32') {
      expect(p.configDir()).toMatch(/difyctl$/)
    }
    else {
      expect(p.configDir()).toBe(join(homedir(), '.config', SUBDIR))
    }
  })

  it('cacheDir ends with the difyctl subdir', () => {
    const p = resolvePlatform()
    if (p.id() === 'win32') {
      expect(p.cacheDir()).toMatch(/difyctl$/)
    }
    else if (p.id() === 'darwin') {
      expect(p.cacheDir()).toBe(join(homedir(), 'Library', 'Caches', SUBDIR))
    }
    else {
      expect(p.cacheDir()).toBe(join(homedir(), '.cache', SUBDIR))
    }
  })

  it('atomicReplace is a function', () => {
    expect(resolvePlatform().atomicReplace).toBeTypeOf('function')
  })
})
