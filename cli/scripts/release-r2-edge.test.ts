import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./release-r2-edge.mjs', import.meta.url))

function run(args: string[]): { code: number, stdout: string, stderr: string } {
  try {
    return { code: 0, stdout: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }), stderr: '' }
  }
  catch (e) {
    const err = e as { status?: number, stdout?: string, stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

// ---- manifest ----

function writeChecksums(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-manifest-'))
  const ids = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']
  const lines = ids.map((id, i) => {
    const exe = id === 'windows-x64' ? '.exe' : ''
    const sha = String(i).repeat(64)
    return `${sha}  difyctl-v${version}-${id}${exe}`
  })
  const file = join(dir, `difyctl-v${version}-checksums.txt`)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

const VERSION = '0.1.0-edge.2fd7b82'
const BASE_URL = 'https://example.r2.dev/difyctl/edge/0.1.0-edge.2fd7b82'

type ManifestJson = {
  schema: number
  name: string
  channel: string
  version: string
  commit: string
  buildDate: string
  compat: { minDify: string, maxDify: string }
  baseUrl: string
  targets: Record<string, { asset: string, sha256: string }>
}

type IndexBuild = {
  version: string
  commit: string
  buildDate: string
  dir: string
}

type IndexJson = {
  schema: number
  channel: string
  updated: string
  builds: IndexBuild[]
}

function buildManifest(version = VERSION): { code: number, json: ManifestJson, stdout: string, stderr: string } {
  const checksums = writeChecksums(version)
  const r = run(['manifest', '--channel', 'edge', '--version', version, '--commit', 'abc1234', '--build-date', '2026-06-14T12:00:00Z', '--base-url', BASE_URL, '--checksums', checksums])
  return { code: r.code, json: (r.code === 0 ? JSON.parse(r.stdout) : null) as ManifestJson, stdout: r.stdout, stderr: r.stderr }
}

describe('release-r2-edge manifest', () => {
  it('emits the core pointer fields', () => {
    const { json } = buildManifest()
    expect(json.schema).toBe(1)
    expect(json.name).toBe('difyctl')
    expect(json.channel).toBe('edge')
    expect(json.version).toBe(VERSION)
    expect(json.commit).toBe('abc1234')
    expect(json.buildDate).toBe('2026-06-14T12:00:00Z')
    expect(json.baseUrl).toBe(BASE_URL)
  })

  it('carries the compat window from package.json', () => {
    const { json } = buildManifest()
    expect(json.compat).toEqual({ minDify: '1.15.0', maxDify: '1.15.0' })
  })

  it('lists all 5 targets with asset name + sha256 from the checksums file', () => {
    const { json } = buildManifest()
    expect(Object.keys(json.targets).sort()).toEqual(
      ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64'],
    )
    expect(json.targets['linux-x64'].asset).toBe(`difyctl-v${VERSION}-linux-x64`)
    expect(json.targets['windows-x64'].asset).toBe(`difyctl-v${VERSION}-windows-x64.exe`)
    expect(json.targets['linux-x64'].sha256).toMatch(/^\d{64}$/)
  })

  it('renders each target on a single line (installer greps it)', () => {
    const { stdout } = buildManifest()
    expect(stdout).toMatch(/^ {4}"linux-x64": \{ "asset": ".*", "sha256": ".*" \}/m)
  })

  it('rejects a version that does not match the channel form', () => {
    const { code } = buildManifest('0.1.0-rc.1')
    expect(code).not.toBe(0)
  })

  it('dies when a target sha is missing from the checksums file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'difyctl-manifest-'))
    const file = join(dir, `difyctl-v${VERSION}-checksums.txt`)
    writeFileSync(file, `${'0'.repeat(64)}  difyctl-v${VERSION}-linux-x64\n`) // only 1 of 5
    const r = run(['manifest', '--channel', 'edge', '--version', VERSION, '--commit', 'abc1234', '--build-date', '2026-06-14T12:00:00Z', '--base-url', BASE_URL, '--checksums', file])
    expect(r.code).not.toBe(0)
  })

  it('rejects a malformed dropped-value argument (no silent misparse)', () => {
    // --version has no value; --commit must NOT be swallowed as the version
    const r = run(['manifest', '--channel', 'edge', '--version', '--commit', 'abc1234', '--build-date', '2026-06-14T12:00:00Z', '--base-url', 'https://x', '--checksums', '/nonexistent'])
    expect(r.code).not.toBe(0)
  })
})

// ---- index ----

function runIndex(currentContent: string | null, build: Record<string, string>, existingDirs?: string[]) {
  let currentArg = '-'
  if (currentContent !== null) {
    const dir = mkdtempSync(join(tmpdir(), 'difyctl-index-'))
    currentArg = join(dir, 'index.json')
    writeFileSync(currentArg, currentContent)
  }
  const extra: string[] = []
  if (existingDirs !== undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'difyctl-existing-'))
    const f = join(dir, 'existing.txt')
    writeFileSync(f, `${existingDirs.join('\n')}\n`)
    extra.push('--existing-dirs', f)
  }
  const r = spawnSync('node', [SCRIPT, 'index', '--current', currentArg, '--channel', 'edge', '--version', build.version, '--commit', build.commit, '--build-date', build.buildDate, ...extra], { encoding: 'utf8' })
  return {
    code: r.status ?? 1,
    index: (r.status === 0 ? JSON.parse(r.stdout) : null) as IndexJson,
  }
}

const B1 = { version: '0.1.0-edge.aaaaaaa', commit: 'aaaaaaa', buildDate: '2026-06-14T09:00:00Z' }
const B2 = { version: '0.1.0-edge.bbbbbbb', commit: 'bbbbbbb', buildDate: '2026-06-14T10:00:00Z' }

describe('release-r2-edge index', () => {
  it('creates a fresh index from a missing current (arg "-")', () => {
    const { index } = runIndex(null, B1)
    expect(index.schema).toBe(1)
    expect(index.channel).toBe('edge')
    expect(index.builds).toHaveLength(1)
    expect(index.builds[0]).toMatchObject({ version: B1.version, commit: B1.commit, dir: B1.version })
  })

  it('treats an empty current file as fresh (first publish, curl wrote nothing)', () => {
    const { code, index } = runIndex('', B1)
    expect(code).toBe(0)
    expect(index.builds).toHaveLength(1)
  })

  it('treats a "-"-content current file as fresh (curl 404 fallback)', () => {
    const { code, index } = runIndex('-\n', B1)
    expect(code).toBe(0)
    expect(index.builds).toHaveLength(1)
  })

  it('prepends the new build (publish order; newest at [0])', () => {
    const current = JSON.stringify({ schema: 1, channel: 'edge', builds: [{ version: B1.version, commit: B1.commit, buildDate: B1.buildDate, dir: B1.version }] })
    const { index } = runIndex(current, B2)
    expect(index.builds.map(b => b.version)).toEqual([B2.version, B1.version])
  })

  it('dedups a re-cut of the same version (no duplicate, moves to top)', () => {
    const current = JSON.stringify({ schema: 1, channel: 'edge', builds: [
      { version: B2.version, commit: B2.commit, buildDate: B2.buildDate, dir: B2.version },
      { version: B1.version, commit: B1.commit, buildDate: B1.buildDate, dir: B1.version },
    ] })
    const { index } = runIndex(current, B1) // re-cut B1
    expect(index.builds.map(b => b.version)).toEqual([B1.version, B2.version])
  })

  it('reconciles to surviving binary dirs (drops a build whose binary expired)', () => {
    const current = JSON.stringify({ schema: 1, channel: 'edge', builds: [
      { version: B1.version, commit: B1.commit, buildDate: B1.buildDate, dir: B1.version },
    ] })
    // B1's binary is gone (not in existing); the new B2 is always kept.
    const { index } = runIndex(current, B2, [B2.version])
    expect(index.builds.map(b => b.version)).toEqual([B2.version])
  })

  it('keeps the new build even when it is absent from the existing-dirs list', () => {
    const { index } = runIndex(null, B1, []) // empty survivors, fresh ledger
    expect(index.builds.map(b => b.version)).toEqual([B1.version])
  })

  it('does not reconcile when no --existing-dirs is given (list unavailable)', () => {
    const current = JSON.stringify({ schema: 1, channel: 'edge', builds: [
      { version: B1.version, commit: B1.commit, buildDate: B1.buildDate, dir: B1.version },
    ] })
    const { index } = runIndex(current, B2) // no existing-dirs → keep all
    expect(index.builds.map(b => b.version)).toEqual([B2.version, B1.version])
  })

  it('dies on a non-empty current file that is not valid JSON', () => {
    const { code } = runIndex('{not json', B1)
    expect(code).not.toBe(0)
  })
})
