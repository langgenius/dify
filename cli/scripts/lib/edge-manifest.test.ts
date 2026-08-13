import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  parseChecksums,
  parseDirList,
  renderManifest,
  resolveTargets,
} from './edge-manifest.mjs'

const RELEASE = {
  tagPrefix: 'testctl-v',
  binName: 'testctl',
  checksumsSuffix: '.sums',
  targets: [
    { id: 'linux-x64', bunTarget: 'bun-linux-x64', exe: false },
    { id: 'windows-x64', bunTarget: 'bun-windows-x64', exe: true },
  ],
}

const VERSION = '7.7.7-edge.2fd7b82'
const SHA_LINUX = 'a'.repeat(64)
const SHA_WINDOWS = 'b'.repeat(64)

const CHECKSUMS = [
  `${SHA_LINUX}  testctl-v${VERSION}-linux-x64`,
  `${SHA_WINDOWS}  testctl-v${VERSION}-windows-x64.exe`,
].join('\n')

describe('parseChecksums', () => {
  it('maps asset name to sha256', () => {
    const map = parseChecksums(CHECKSUMS)
    expect(map.get(`testctl-v${VERSION}-linux-x64`)).toBe(SHA_LINUX)
    expect(map.get(`testctl-v${VERSION}-windows-x64.exe`)).toBe(SHA_WINDOWS)
  })

  it('ignores blank and malformed lines', () => {
    expect(parseChecksums('\nnot a checksum line\n\n').size).toBe(0)
  })
})

describe('parseDirList', () => {
  it('collects non-blank trimmed lines', () => {
    expect([...parseDirList('  a \n\n b\n')]).toEqual(['a', 'b'])
  })

  it('yields an empty set for empty input', () => {
    expect(parseDirList('').size).toBe(0)
  })
})

describe('resolveTargets', () => {
  it('pairs every target with its sha', () => {
    const { targets, missing } = resolveTargets(RELEASE, VERSION, parseChecksums(CHECKSUMS))
    expect(missing).toEqual([])
    expect(targets).toEqual([
      { id: 'linux-x64', asset: `testctl-v${VERSION}-linux-x64`, sha: SHA_LINUX },
      { id: 'windows-x64', asset: `testctl-v${VERSION}-windows-x64.exe`, sha: SHA_WINDOWS },
    ])
  })

  it('reports assets with no checksum', () => {
    const partial = parseChecksums(`${SHA_LINUX}  testctl-v${VERSION}-linux-x64`)
    const { targets, missing } = resolveTargets(RELEASE, VERSION, partial)
    expect(targets).toHaveLength(1)
    expect(missing).toEqual([`testctl-v${VERSION}-windows-x64.exe`])
  })
})

describe('renderManifest', () => {
  const manifest = () =>
    renderManifest({
      binName: RELEASE.binName,
      channel: 'edge',
      version: VERSION,
      commit: 'abc1234',
      buildDate: '2026-06-14T12:00:00Z',
      compat: { minDify: '2.0.0', maxDify: '2.5.0' },
      baseUrl: 'https://example.r2.dev/testctl/edge',
      targets: resolveTargets(RELEASE, VERSION, parseChecksums(CHECKSUMS)).targets,
    })

  it('emits the pointer fields', () => {
    const json = JSON.parse(manifest())
    expect(json).toMatchObject({
      schema: 1,
      name: 'testctl',
      channel: 'edge',
      version: VERSION,
      commit: 'abc1234',
      buildDate: '2026-06-14T12:00:00Z',
      baseUrl: 'https://example.r2.dev/testctl/edge',
    })
  })

  it('carries both compat bounds through unswapped', () => {
    expect(JSON.parse(manifest()).compat).toEqual({ minDify: '2.0.0', maxDify: '2.5.0' })
  })

  it('lists each target with asset name and sha256', () => {
    expect(JSON.parse(manifest()).targets).toEqual({
      'linux-x64': { asset: `testctl-v${VERSION}-linux-x64`, sha256: SHA_LINUX },
      'windows-x64': { asset: `testctl-v${VERSION}-windows-x64.exe`, sha256: SHA_WINDOWS },
    })
  })

  it('renders each target on a single line (install-r2.sh greps it)', () => {
    expect(manifest()).toMatch(/^ {4}"linux-x64": \{ "asset": ".*", "sha256": ".*" \}/m)
  })
})

describe('buildIndex', () => {
  const B1 = { version: '7.7.7-edge.aaaaaaa', commit: 'aaaaaaa', buildDate: '2026-06-14T09:00:00Z' }
  const B2 = { version: '7.7.7-edge.bbbbbbb', commit: 'bbbbbbb', buildDate: '2026-06-14T10:00:00Z' }
  const entryOf = (b: typeof B1) => ({ ...b, dir: b.version })
  const build = (over = {}) =>
    buildIndex({ channel: 'edge', ...B2, current: null, existingDirs: null, ...over })

  it('creates a fresh ledger when there is no current index', () => {
    const index = build()
    expect(index).toMatchObject({ schema: 1, channel: 'edge', updated: B2.buildDate })
    expect(index.builds).toEqual([entryOf(B2)])
  })

  it('prepends the new build, newest first', () => {
    const index = build({ current: { builds: [entryOf(B1)] } })
    expect(index.builds).toEqual([entryOf(B2), entryOf(B1)])
  })

  it('replaces an existing entry for the same version rather than duplicating', () => {
    const stale = { ...entryOf(B2), commit: 'oldsha' }
    const index = build({ current: { builds: [stale, entryOf(B1)] } })
    expect(index.builds).toEqual([entryOf(B2), entryOf(B1)])
  })

  it('drops builds whose binaries no longer exist in R2', () => {
    const index = build({
      current: { builds: [entryOf(B1)] },
      existingDirs: new Set<string>(),
    })
    expect(index.builds).toEqual([entryOf(B2)])
  })

  it('keeps builds that still exist in R2', () => {
    const index = build({
      current: { builds: [entryOf(B1)] },
      existingDirs: new Set([B1.version]),
    })
    expect(index.builds).toEqual([entryOf(B2), entryOf(B1)])
  })

  it('reconciles nothing when the caller could not list R2', () => {
    const index = build({ current: { builds: [entryOf(B1)] }, existingDirs: null })
    expect(index.builds).toEqual([entryOf(B2), entryOf(B1)])
  })
})
