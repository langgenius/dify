import { describe, expect, it } from 'vitest'
import {
  assetNameFor,
  channelVersionProblem,
  checksumsName,
  compatProblems,
  edgeVersionFrom,
  edgeVersionProblem,
  isWithinCompatWindow,
  releaseConfigProblems,
  tagName,
} from './release-rules.mjs'

const RELEASE = {
  tagPrefix: 'testctl-v',
  binName: 'testctl',
  checksumsSuffix: '.sums',
  targets: [
    { id: 'linux-x64', bunTarget: 'bun-linux-x64', exe: false },
    { id: 'windows-x64', bunTarget: 'bun-windows-x64', exe: true },
  ],
}

const WINDOW = { minDify: '2.0.0', maxDify: '2.5.0' }

describe('isWithinCompatWindow', () => {
  it.each([
    ['2.3.0', true, 'inside the window'],
    ['2.0.0', true, 'the inclusive lower bound'],
    ['2.5.0', true, 'the inclusive upper bound'],
    ['v2.3.0', true, 'a v-prefixed tag'],
    ['1.9.9', false, 'below the lower bound'],
    ['2.5.1', false, 'above the upper bound'],
  ])('%s -> %s (%s)', (version, expected) => {
    expect(isWithinCompatWindow(version, WINDOW)).toBe(expected)
  })

  it.each([
    ['2.0.0-rc.1', true, 'a prerelease of the lower bound ranks equal to it'],
    ['2.5.0-rc.1', true, 'a prerelease of the upper bound ranks equal to it'],
    ['2.3.0-alpha.7+build9', true, 'both suffixes stripped before comparing'],
    ['2.5.0+build123', true, 'build metadata on the upper bound'],
    ['2.5.1-rc.1', false, 'a prerelease whose core is above the window'],
    ['1.9.9-rc.1', false, 'a prerelease whose core is below the window'],
    ['2.5.1+build123', false, 'build metadata out of range'],
  ])('ignores suffixes: %s -> %s (%s)', (version, expected) => {
    expect(isWithinCompatWindow(version, WINDOW)).toBe(expected)
  })
})

describe('channelVersionProblem', () => {
  it.each([
    ['1.2.3', 'stable'],
    ['1.2.3+build', 'stable'],
    ['1.2.3-alpha', 'alpha'],
    ['1.2.3-alpha.4', 'alpha'],
    ['1.2.3-rc.4', 'rc'],
    ['1.2.3-edge.2fd7b82', 'edge'],
  ])('accepts %s on the %s channel', (version, channel) => {
    expect(channelVersionProblem(version, channel)).toBeNull()
  })

  it.each([
    ['1.2.3-rc.1', 'edge'],
    ['1.2.3-alpha', 'stable'],
    ['1.2.3', 'rc'],
  ])('rejects %s on the %s channel', (version, channel) => {
    expect(channelVersionProblem(version, channel)).toMatch(/does not match the .* channel form/)
  })

  it('rejects an unknown channel', () => {
    expect(channelVersionProblem('1.2.3', 'nightly')).toMatch(/unknown channel/)
  })

  it('rejects an empty version', () => {
    expect(channelVersionProblem('', 'stable')).toMatch(/non-empty string/)
  })
})

describe('edge version derivation', () => {
  it('derives <core>-edge.<sha>, dropping the prerelease', () => {
    expect(edgeVersionProblem('3.4.5-alpha', '2fd7b82')).toBeNull()
    expect(edgeVersionFrom('3.4.5-alpha', '2fd7b82')).toBe('3.4.5-edge.2fd7b82')
  })

  it('accepts a 40-char sha', () => {
    const sha = '2fd7b829e1f0aaaabbbbccccddddeeeeffff0000'
    expect(edgeVersionProblem('3.4.5-alpha', sha)).toBeNull()
    expect(edgeVersionFrom('3.4.5-alpha', sha)).toBe(`3.4.5-edge.${sha}`)
  })

  it.each([['nothex!'], [''], ['abc'], [undefined]])('rejects sha %s', (sha) => {
    expect(edgeVersionProblem('3.4.5-alpha', sha)).toMatch(/git short sha/)
  })

  it('rejects a version with no derivable core', () => {
    expect(edgeVersionProblem('not-a-version', '2fd7b82')).toMatch(/cannot derive edge base/)
  })
})

describe('artifact names', () => {
  it('builds the tag and checksums names from the prefix', () => {
    expect(tagName(RELEASE, '9.9.9')).toBe('testctl-v9.9.9')
    expect(checksumsName(RELEASE, '9.9.9')).toBe('testctl-v9.9.9.sums')
  })

  it('appends .exe only for targets flagged exe', () => {
    expect(assetNameFor(RELEASE, '9.9.9', 'linux-x64')).toBe('testctl-v9.9.9-linux-x64')
    expect(assetNameFor(RELEASE, '9.9.9', 'windows-x64')).toBe('testctl-v9.9.9-windows-x64.exe')
  })

  it('returns null for an unknown target id', () => {
    expect(assetNameFor(RELEASE, '9.9.9', 'solaris-sparc')).toBeNull()
  })
})

describe('compatProblems', () => {
  it('accepts a well-formed window', () => {
    expect(compatProblems(WINDOW)).toEqual([])
    expect(compatProblems({ minDify: '2.0.0', maxDify: '2.0.0' })).toEqual([])
  })

  it.each([
    [undefined, /minDify must be a non-empty string/],
    [{ maxDify: '2.5.0' }, /minDify must be a non-empty string/],
    [{ minDify: '2.0.0' }, /maxDify must be a non-empty string/],
    [{ minDify: '', maxDify: '' }, /minDify must be a non-empty string/],
  ])('flags a missing bound', (compat, expected) => {
    expect(compatProblems(compat).join('\n')).toMatch(expected)
  })

  it('compares bounds by core, so suffixes do not make a window inverted', () => {
    expect(compatProblems({ minDify: '2.0.0-rc.1', maxDify: '2.0.0' })).toEqual([])
  })

  it('flags an inverted window', () => {
    expect(compatProblems({ minDify: '2.5.0', maxDify: '2.0.0' }).join('\n')).toMatch(
      /must not exceed/,
    )
  })
})

describe('releaseConfigProblems', () => {
  it('accepts a well-formed config', () => {
    expect(releaseConfigProblems(RELEASE)).toEqual([])
  })

  it.each([
    [{ ...RELEASE, tagPrefix: '' }, /tagPrefix must be a non-empty string/],
    [{ ...RELEASE, binName: '' }, /binName must be a non-empty string/],
    [{ ...RELEASE, checksumsSuffix: '' }, /checksumsSuffix must be a non-empty string/],
    [{ ...RELEASE, targets: [] }, /targets must be a non-empty array/],
    [{ ...RELEASE, targets: undefined }, /targets must be a non-empty array/],
  ])('flags a malformed field', (release, expected) => {
    expect(releaseConfigProblems(release).join('\n')).toMatch(expected)
  })

  it('flags a duplicate target id', () => {
    const release = { ...RELEASE, targets: [RELEASE.targets[0], { ...RELEASE.targets[0] }] }
    expect(releaseConfigProblems(release).join('\n')).toMatch(/duplicate target id: linux-x64/)
  })

  it('flags a bunTarget that is not a bun triple', () => {
    const release = { ...RELEASE, targets: [{ id: 'a', bunTarget: 'linux-x64', exe: false }] }
    expect(releaseConfigProblems(release).join('\n')).toMatch(/bunTarget must match/)
  })

  it('flags exe disagreeing with a windows bunTarget', () => {
    const release = {
      ...RELEASE,
      targets: [{ id: 'windows-x64', bunTarget: 'bun-windows-x64', exe: false }],
    }
    expect(releaseConfigProblems(release).join('\n')).toMatch(/exe must be true iff/)
  })

  it('flags a non-boolean exe', () => {
    const release = {
      ...RELEASE,
      targets: [{ id: 'linux-x64', bunTarget: 'bun-linux-x64', exe: 'no' }],
    }
    expect(releaseConfigProblems(release).join('\n')).toMatch(/exe must be a boolean/)
  })
})
