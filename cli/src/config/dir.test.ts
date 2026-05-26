import { describe, expect, it } from 'vitest'
import { DIR_PERM, FILE_PERM, resolveConfigDir } from './dir.js'

function fakeEnv(opts: {
  override?: string
  xdg?: string
  home?: string
  appData?: string
  platform: NodeJS.Platform
}) {
  return {
    getEnv: (name: string) => {
      if (name === 'DIFY_CONFIG_DIR')
        return opts.override
      if (name === 'XDG_CONFIG_HOME')
        return opts.xdg
      return undefined
    },
    homeDir: () => opts.home ?? '/home/u',
    platform: () => opts.platform,
    appData: () => opts.appData,
  }
}

describe('config dir', () => {
  it('FILE_PERM is 0o600 + DIR_PERM is 0o700 (POSIX defaults)', () => {
    expect(FILE_PERM).toBe(0o600)
    expect(DIR_PERM).toBe(0o700)
  })

  it('DIFY_CONFIG_DIR override wins on every platform', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(resolveConfigDir(fakeEnv({ override: '/tmp/x', platform })))
        .toBe('/tmp/x')
    }
  })

  it('linux uses XDG_CONFIG_HOME when set', () => {
    expect(resolveConfigDir(fakeEnv({ xdg: '/x', platform: 'linux' })))
      .toBe('/x/difyctl')
  })

  it('linux falls back to ~/.config when XDG unset', () => {
    expect(resolveConfigDir(fakeEnv({ home: '/h', platform: 'linux' })))
      .toBe('/h/.config/difyctl')
  })

  it('linux ignores empty XDG_CONFIG_HOME', () => {
    expect(resolveConfigDir(fakeEnv({ xdg: '', home: '/h', platform: 'linux' })))
      .toBe('/h/.config/difyctl')
  })

  it('macos uses ~/.config (not XDG, matches gh/kubectl)', () => {
    expect(resolveConfigDir(fakeEnv({ xdg: '/ignored', home: '/h', platform: 'darwin' })))
      .toBe('/h/.config/difyctl')
  })

  it('windows uses APPDATA', () => {
    expect(resolveConfigDir(fakeEnv({ appData: 'C:\\Users\\u\\AppData\\Roaming', platform: 'win32' })))
      .toMatch(/difyctl$/)
  })

  it('windows throws if APPDATA unresolvable', () => {
    expect(() => resolveConfigDir(fakeEnv({ platform: 'win32' }))).toThrow(/APPDATA/)
  })

  it('unknown platform falls back to ~/.config', () => {
    expect(resolveConfigDir(fakeEnv({ home: '/h', platform: 'freebsd' as NodeJS.Platform })))
      .toBe('/h/.config/difyctl')
  })
})
