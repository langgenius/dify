import { describe, expect, it } from 'vitest'
import { resolveBuildInfo } from '../../scripts/lib/resolve-buildinfo.js'

const FIXED_DATE = new Date('2026-05-09T12:00:00.000Z')
const fixedNow = () => FIXED_DATE
const noGit = () => null
// Stub the package.json reader so tests exercise the "no sources" path
// without coupling to the live cli/package.json#difyctl.compat values.
const noPkg = () => ({})

describe('resolveBuildInfo', () => {
  it('uses env values when fully populated', () => {
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_VERSION: '1.2.3',
        DIFYCTL_COMMIT: 'abcdef0123456789',
        DIFYCTL_BUILD_DATE: '2026-01-01T00:00:00.000Z',
        DIFYCTL_CHANNEL: 'stable',
      },
      git: () => 'should-not-be-called',
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info).toStrictEqual({
      version: '1.2.3',
      commit: 'abcdef0123456789',
      buildDate: '2026-01-01T00:00:00.000Z',
      channel: 'stable',
      minDify: '0.0.0',
      maxDify: '0.0.0',
    })
  })

  it('falls back to git probes when env unset', () => {
    const calls: string[] = []
    const git = (cmd: string) => {
      calls.push(cmd)
      if (cmd.startsWith('git describe'))
        return 'v1.0.0-5-gabc1234-dirty'
      if (cmd.startsWith('git rev-parse'))
        return '1234567890abcdef'
      return null
    }
    const info = resolveBuildInfo({ env: {}, git, now: fixedNow, pkg: noPkg })
    expect(info).toStrictEqual({
      version: 'v1.0.0-5-gabc1234-dirty',
      commit: '1234567890abcdef',
      buildDate: '2026-05-09T12:00:00.000Z',
      channel: 'dev',
      minDify: '0.0.0',
      maxDify: '0.0.0',
    })
    expect(calls).toStrictEqual([
      'git describe --tags --dirty --always',
      'git rev-parse HEAD',
    ])
  })

  it('uses string defaults when env unset, git unavailable, and package.json empty', () => {
    const info = resolveBuildInfo({ env: {}, git: noGit, now: fixedNow, pkg: noPkg })
    expect(info).toStrictEqual({
      version: '0.0.0-dev',
      commit: 'none',
      buildDate: '2026-05-09T12:00:00.000Z',
      channel: 'dev',
      minDify: '0.0.0',
      maxDify: '0.0.0',
    })
  })

  it('throws on invalid channel', () => {
    expect(() =>
      resolveBuildInfo({ env: { DIFYCTL_CHANNEL: 'beta' }, git: noGit, now: fixedNow, pkg: noPkg }),
    ).toThrow(/invalid DIFYCTL_CHANNEL: beta/)
  })

  it('throws on removed nightly channel', () => {
    expect(() =>
      resolveBuildInfo({ env: { DIFYCTL_CHANNEL: 'nightly' }, git: noGit, now: fixedNow, pkg: noPkg }),
    ).toThrow(/invalid DIFYCTL_CHANNEL: nightly/)
  })

  it('accepts rc channel', () => {
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_VERSION: '0.1.0-rc.1',
        DIFYCTL_CHANNEL: 'rc',
        DIFYCTL_COMMIT: 'abc',
        DIFYCTL_BUILD_DATE: '2026-01-01T00:00:00.000Z',
      },
      git: noGit,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.channel).toBe('rc')
  })

  it('mixes env and git fallbacks per field', () => {
    const git = (cmd: string) => (cmd.startsWith('git describe') ? 'v9.9.9' : null)
    const info = resolveBuildInfo({
      env: { DIFYCTL_COMMIT: 'pinned-sha' },
      git,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.version).toBe('v9.9.9')
    expect(info.commit).toBe('pinned-sha')
    expect(info.channel).toBe('dev')
  })

  it('reads minDify and maxDify from env', () => {
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_VERSION: '0.1.0-rc.1',
        DIFYCTL_CHANNEL: 'rc',
        DIFYCTL_COMMIT: 'abc',
        DIFYCTL_BUILD_DATE: '2026-01-01T00:00:00.000Z',
        DIFYCTL_MIN_DIFY: '1.6.0',
        DIFYCTL_MAX_DIFY: '1.7.0',
      },
      git: noGit,
      now: fixedNow,
      pkg: noPkg,
    })
    expect(info.minDify).toBe('1.6.0')
    expect(info.maxDify).toBe('1.7.0')
  })

  it('defaults minDify and maxDify to 0.0.0 when env and package.json are unset', () => {
    const info = resolveBuildInfo({ env: {}, git: noGit, now: fixedNow, pkg: noPkg })
    expect(info.minDify).toBe('0.0.0')
    expect(info.maxDify).toBe('0.0.0')
  })

  it('falls back to package.json#difyctl.compat when env unset', () => {
    const pkg = () => ({ difyctl: { compat: { minDify: '1.6.0', maxDify: '1.7.0' }, channel: 'rc' } })
    const info = resolveBuildInfo({ env: {}, git: noGit, now: fixedNow, pkg })
    expect(info.minDify).toBe('1.6.0')
    expect(info.maxDify).toBe('1.7.0')
    expect(info.channel).toBe('rc')
  })

  it('env wins over package.json for compat range and channel', () => {
    const pkg = () => ({ difyctl: { compat: { minDify: '1.6.0', maxDify: '1.7.0' }, channel: 'rc' } })
    const info = resolveBuildInfo({
      env: {
        DIFYCTL_MIN_DIFY: '2.0.0',
        DIFYCTL_MAX_DIFY: '2.1.0',
        DIFYCTL_CHANNEL: 'stable',
      },
      git: noGit,
      now: fixedNow,
      pkg,
    })
    expect(info.minDify).toBe('2.0.0')
    expect(info.maxDify).toBe('2.1.0')
    expect(info.channel).toBe('stable')
  })
})
