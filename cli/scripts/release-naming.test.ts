import { describe, expect, it } from 'vitest'
import { main } from './release-naming.mjs'

describe('release-naming argument handling', () => {
  it.each([
    [['tag'], 'version argument is required'],
    [['asset'], 'version argument is required'],
    [['checksums'], 'version argument is required'],
    [['compat-check'], 'version argument is required'],
    [['validate-version'], 'version argument is required'],
    [['prerelease'], 'channel argument is required'],
    [['edge-version'], 'git short sha'],
    [['bogus'], 'unknown subcommand'],
    [[], 'unknown subcommand'],
  ])('rejects %j', (args, message) => {
    expect(() => main(args)).toThrow(message)
  })

  it('rejects an unknown target id', () => {
    expect(() => main(['asset', '9.9.9', 'solaris-sparc'])).toThrow('unknown target id')
  })
})

describe('release-naming output shape', () => {
  it('emits every key CI reads from github-env', () => {
    const out = main(['github-env'])
    for (const key of [
      'version',
      'channel',
      'prerelease',
      'minDify',
      'maxDify',
      'tagPrefix',
      'difyctlTag',
    ])
      expect(out).toMatch(new RegExp(`^${key}=.+$`, 'm'))
    expect(out).not.toMatch(/=undefined$/m)
  })

  it('emits difyctlTag as tagPrefix immediately followed by version', () => {
    const env = Object.fromEntries(
      main(['github-env'])
        .split('\n')
        .filter(Boolean)
        .map((line: string) => line.split(/=(.*)/s).slice(0, 2)),
    )
    expect(env.difyctlTag).toBe(`${env.tagPrefix}${env.version}`)
  })

  it('lists one channel per line, including edge', () => {
    const out = main(['channels'])
    expect(out.trim().split('\n').length).toBeGreaterThan(1)
    expect(out).toMatch(/^edge$/m)
  })

  it('emits targets as bunTarget<TAB>id<TAB>0|1 (release-build.sh parses this)', () => {
    for (const line of main(['targets']).trim().split('\n'))
      expect(line).toMatch(/^\S+\t\S+\t[01]$/)
  })

  it('reports prerelease as a boolean per channel', () => {
    expect(main(['prerelease', 'stable']).trim()).toBe('false')
    expect(main(['prerelease', 'alpha']).trim()).toBe('true')
    expect(() => main(['prerelease', 'nightly'])).toThrow('unknown channel')
  })

  it('derives an edge version from the packaged version and a sha', () => {
    expect(main(['edge-version', '2fd7b82']).trim()).toMatch(/-edge\.2fd7b82$/)
  })

  it('validates a version against a channel form', () => {
    expect(main(['validate-version', '0.1.0-edge.2fd7b82', 'edge'])).toContain('valid')
    expect(() => main(['validate-version', '0.1.0-rc.1', 'edge'])).toThrow(
      'does not match the edge channel form',
    )
  })
})
