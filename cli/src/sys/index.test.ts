import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { resolvePlatform, SUBDIR } from './index'

describe('resolvePlatform', () => {
  it('id matches process.platform', () => {
    expect(resolvePlatform().id()).toBe(process.platform)
  })

  it('configDir ends with the difyctl subdir', () => {
    const p = resolvePlatform()
    if (p.id() === 'win32') {
      expect(p.configDir()).toMatch(/difyctl$/)
    } else {
      expect(p.configDir()).toBe(join(homedir(), '.config', SUBDIR))
    }
  })

  it('atomicReplace is a function', () => {
    expect(resolvePlatform().atomicReplace).toBeTypeOf('function')
  })
})

describe('atomicReplace', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'difyctl-replace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('replaces an existing file with the new contents', () => {
    const source = join(dir, 'settings.tmp')
    const target = join(dir, 'settings.yaml')
    writeFileSync(source, 'new settings')
    writeFileSync(target, 'old settings')

    resolvePlatform().atomicReplace(source, target)

    expect(readFileSync(target, 'utf8')).toBe('new settings')
    expect(existsSync(source)).toBe(false)
  })

  it('creates the destination when no previous file exists', () => {
    const source = join(dir, 'settings.tmp')
    const target = join(dir, 'settings.yaml')
    writeFileSync(source, 'new settings')

    resolvePlatform().atomicReplace(source, target)

    expect(readFileSync(target, 'utf8')).toBe('new settings')
    expect(existsSync(source)).toBe(false)
  })

  it('preserves the existing file when the replacement source is missing', () => {
    const source = join(dir, 'missing.tmp')
    const target = join(dir, 'settings.yaml')
    writeFileSync(target, 'old settings')

    expect(() => resolvePlatform().atomicReplace(source, target)).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('old settings')
  })
})
