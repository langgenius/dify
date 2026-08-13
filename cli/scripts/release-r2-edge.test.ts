import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main as naming } from './release-naming.mjs'
import { main } from './release-r2-edge.mjs'

const VERSION = '0.1.0-edge.2fd7b82'
const BASE_URL = 'https://example.r2.dev/difyctl/edge/0.1.0-edge.2fd7b82'

const TARGET_IDS = naming(['targets'])
  .trim()
  .split('\n')
  .map((line: string) => line.split('\t')[1])

const ASSETS = new Map(TARGET_IDS.map((id: string) => [id, naming(['asset', VERSION, id]).trim()]))
const assetFor = (id: string) => ASSETS.get(id) ?? ''

const PKG_ENV = Object.fromEntries(
  naming(['github-env'])
    .split('\n')
    .filter(Boolean)
    .map((line: string) => line.split(/=(.*)/s).slice(0, 2)),
)

type ManifestJson = {
  schema: number
  name: string
  channel: string
  version: string
  commit: string
  buildDate: string
  compat: { minDify: string; maxDify: string }
  baseUrl: string
  targets: Record<string, { asset: string; sha256: string }>
}

type IndexJson = {
  schema: number
  channel: string
  updated: string
  builds: { version: string; commit: string; buildDate: string; dir: string }[]
}

function writeChecksums(ids: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-manifest-'))
  const lines = ids.map((id, i) => `${String(i).repeat(64)}  ${assetFor(id)}`)
  const file = join(dir, 'checksums.txt')
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

function manifestArgs(version = VERSION, ids = TARGET_IDS): string[] {
  return [
    'manifest',
    '--channel',
    'edge',
    '--version',
    version,
    '--commit',
    'abc1234',
    '--build-date',
    '2026-06-14T12:00:00Z',
    '--base-url',
    BASE_URL,
    '--checksums',
    writeChecksums(ids),
  ]
}

const buildManifest = () => JSON.parse(main(manifestArgs())) as ManifestJson

describe('release-r2-edge manifest', () => {
  it('passes the CLI arguments straight through to the manifest', () => {
    expect(buildManifest()).toMatchObject({
      schema: 1,
      channel: 'edge',
      version: VERSION,
      commit: 'abc1234',
      buildDate: '2026-06-14T12:00:00Z',
      baseUrl: BASE_URL,
    })
  })

  it('carries the compat window through from cli/package.json', () => {
    expect(buildManifest().compat).toEqual({ minDify: PKG_ENV.minDify, maxDify: PKG_ENV.maxDify })
  })

  it('includes every target the release config declares', () => {
    expect(Object.keys(buildManifest().targets).sort()).toEqual([...TARGET_IDS].sort())
  })

  it('rejects a version that does not match the channel form', () => {
    expect(() => main(manifestArgs('0.1.0-rc.1'))).toThrow('does not match the edge channel form')
  })

  it('dies when a target sha is missing from the checksums file', () => {
    expect(() => main(manifestArgs(VERSION, TARGET_IDS.slice(0, 1)))).toThrow('no sha256 for')
  })

  it('rejects a malformed dropped-value argument (no silent misparse)', () => {
    // --version has no value; --commit must NOT be swallowed as the version
    expect(() =>
      main([
        'manifest',
        '--channel',
        'edge',
        '--version',
        '--commit',
        'abc1234',
        '--build-date',
        '2026-06-14T12:00:00Z',
        '--base-url',
        'https://x',
        '--checksums',
        '/nonexistent',
      ]),
    ).toThrow('malformed argument')
  })

  it('rejects an unknown subcommand', () => {
    expect(() => main(['bogus'])).toThrow('unknown subcommand')
  })
})

describe('release-r2-edge index', () => {
  const B1 = { version: '0.1.0-edge.aaaaaaa', commit: 'aaaaaaa', buildDate: '2026-06-14T09:00:00Z' }

  function indexArgs(currentContent: string | null, existingDirs?: string[]): string[] {
    let currentArg = '-'
    if (currentContent !== null) {
      currentArg = join(mkdtempSync(join(tmpdir(), 'difyctl-index-')), 'index.json')
      writeFileSync(currentArg, currentContent)
    }
    const extra: string[] = []
    if (existingDirs !== undefined) {
      const f = join(mkdtempSync(join(tmpdir(), 'difyctl-existing-')), 'existing.txt')
      writeFileSync(f, `${existingDirs.join('\n')}\n`)
      extra.push('--existing-dirs', f)
    }
    return [
      'index',
      '--current',
      currentArg,
      '--channel',
      'edge',
      '--version',
      B1.version,
      '--commit',
      B1.commit,
      '--build-date',
      B1.buildDate,
      ...extra,
    ]
  }

  const buildIndex = (currentContent: string | null, existingDirs?: string[]) =>
    JSON.parse(main(indexArgs(currentContent, existingDirs))) as IndexJson

  it.each([
    ['a missing current file (arg "-")', null],
    ['an empty current file (first publish, curl wrote nothing)', ''],
    ['a "-"-content current file (curl 404 fallback)', '-\n'],
  ])('treats %s as a fresh ledger', (_label, content) => {
    const index = buildIndex(content)
    expect(index).toMatchObject({ schema: 1, channel: 'edge' })
    expect(index.builds).toEqual([{ ...B1, dir: B1.version }])
  })

  it('dies on a current index that is not valid JSON', () => {
    expect(() => main(indexArgs('{not json'))).toThrow('not valid JSON')
  })

  it('reads the existing-dirs file to reconcile the ledger', () => {
    const older = {
      version: '0.1.0-edge.bbbbbbb',
      commit: 'bbbbbbb',
      buildDate: '2026-06-14T08:00:00Z',
      dir: '0.1.0-edge.bbbbbbb',
    }
    const current = JSON.stringify({ schema: 1, channel: 'edge', builds: [older] })
    expect(buildIndex(current, []).builds).toEqual([{ ...B1, dir: B1.version }])
    expect(buildIndex(current, [older.dir]).builds).toEqual([{ ...B1, dir: B1.version }, older])
  })
})
