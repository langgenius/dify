import type { PkgManifestOverrides } from '../test/fixtures/pkg-manifest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import {
  FIXTURE_CHANNEL,
  FIXTURE_COMPAT,
  FIXTURE_TAG_PREFIX,
  FIXTURE_VERSION,
  pkgManifestEnv,
} from '../test/fixtures/pkg-manifest'

const SCRIPT = fileURLToPath(new URL('./release-naming.mjs', import.meta.url))

const PKG_ENV = pkgManifestEnv()

type RunResult = { code: number; stdout: string; stderr: string }

function exec(args: string[], pkgEnv: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...pkgEnv },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

function run(args: string[]): RunResult {
  return exec(args, PKG_ENV)
}

function runWith(overrides: PkgManifestOverrides, args: string[]): RunResult {
  return exec(args, pkgManifestEnv(overrides))
}

type FixtureManifest = {
  version?: string
  difyctl: { channel?: string; compat: { minDify?: string; maxDify?: string } }
}

function runOnManifest(mutate: (manifest: FixtureManifest) => void, args: string[]): RunResult {
  const pkgEnv = pkgManifestEnv()
  const [pkgPath] = Object.values(pkgEnv)
  if (!pkgPath) throw new Error('pkgManifestEnv returned no manifest path')
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as FixtureManifest
  mutate(manifest)
  writeFileSync(pkgPath, JSON.stringify(manifest))
  return exec(args, pkgEnv)
}

function parseKeyValues(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

describe('release-naming compat-check', () => {
  const { minDify, maxDify } = FIXTURE_COMPAT // 2.0.0 .. 2.5.0
  const compatCheck = (difyVersion?: string) =>
    run(difyVersion === undefined ? ['compat-check'] : ['compat-check', difyVersion]).code

  it('accepts a version inside the window', () => {
    expect(compatCheck('2.3.0')).toBe(0)
  })

  it('accepts the inclusive lower bound', () => {
    expect(compatCheck(minDify)).toBe(0)
  })

  it('accepts the inclusive upper bound', () => {
    expect(compatCheck(maxDify)).toBe(0)
  })

  it('accepts a v-prefixed tag', () => {
    expect(compatCheck('v2.3.0')).toBe(0)
  })

  it('rejects a version below the lower bound', () => {
    expect(compatCheck('1.9.9')).not.toBe(0)
  })

  it('rejects a version above the upper bound', () => {
    expect(compatCheck('2.5.1')).not.toBe(0)
  })

  it('treats a prerelease of the lower bound as below it', () => {
    expect(compatCheck(`${minDify}-rc1`)).not.toBe(0)
  })

  it('ignores build metadata on the bound', () => {
    expect(compatCheck(`${maxDify}+build123`)).toBe(0)
  })

  it('ignores build metadata when out of range', () => {
    expect(compatCheck('2.5.1+build123')).not.toBe(0)
  })

  it('requires a version argument', () => {
    expect(compatCheck()).not.toBe(0)
  })

  it('rejects an LTS-shaped release below the support floor', () => {
    expect(compatCheck('1.13.9')).not.toBe(0)
  })

  it('rejects the next minor above the ceiling', () => {
    expect(compatCheck('2.6.0')).not.toBe(0)
  })
})

describe('release-naming github-env', () => {
  it('emits every manifest field for $GITHUB_ENV, plus a composed difyctlTag', () => {
    const fields = parseKeyValues(run(['github-env']).stdout)
    expect(fields).toEqual({
      version: FIXTURE_VERSION,
      channel: FIXTURE_CHANNEL,
      prerelease: 'false',
      minDify: FIXTURE_COMPAT.minDify,
      maxDify: FIXTURE_COMPAT.maxDify,
      tagPrefix: FIXTURE_TAG_PREFIX,
      difyctlTag: `${FIXTURE_TAG_PREFIX}${FIXTURE_VERSION}`,
    })
  })
})

describe('release-naming edge channel', () => {
  it('lists edge among channels', () => {
    expect(run(['channels']).stdout).toMatch(/^edge$/m)
  })

  it('edge-version derives <version core>-edge.<sha> from the package version', () => {
    expect(run(['edge-version', '2fd7b82']).stdout.trim()).toBe(`${FIXTURE_VERSION}-edge.2fd7b82`)
  })

  it('edge-version accepts a 40-char sha', () => {
    const sha = '2fd7b829e1f0aaaabbbbccccddddeeeeffff0000'
    expect(run(['edge-version', sha]).stdout.trim()).toBe(`${FIXTURE_VERSION}-edge.${sha}`)
  })

  it('edge-version rejects a non-hex sha', () => {
    expect(run(['edge-version', 'nothex!']).code).not.toBe(0)
  })

  it('edge-version requires a sha argument', () => {
    expect(run(['edge-version']).code).not.toBe(0)
  })

  it('edge-version fails when the manifest carries no version', () => {
    const { code, stderr } = runOnManifest(
      (m) => {
        delete m.version
      },
      ['edge-version', '2fd7b82'],
    )
    expect(code).not.toBe(0)
    expect(stderr).toContain('cannot derive edge base from version')
  })

  it('the edge version form matches a computed edge version', () => {
    expect(run(['validate-version', '0.1.0-edge.2fd7b82', 'edge']).code).toBe(0)
  })

  it('validate-version rejects an rc string under the edge channel', () => {
    expect(run(['validate-version', '0.1.0-rc.1', 'edge']).code).not.toBe(0)
  })
})

describe('release-naming validate channel', () => {
  const validateChannel = (channel: string) => runWith({ channel }, ['validate'])

  it.each<[string, string]>([
    ['stable', FIXTURE_VERSION],
    ['alpha', `${FIXTURE_VERSION}-alpha`],
    ['rc', `${FIXTURE_VERSION}-rc.1`],
    ['edge', `${FIXTURE_VERSION}-edge.2fd7b82`],
  ])('accepts the %s channel with a version in its form', (channel, version) => {
    expect(runWith({ channel, version }, ['validate']).code).toBe(0)
  })

  it('rejects a typo of a real channel and names it', () => {
    const { code, stderr } = validateChannel('stabel')
    expect(code).not.toBe(0)
    expect(stderr).toContain('unknown channel: stabel')
  })

  it('rejects the removed nightly channel', () => {
    expect(validateChannel('nightly').code).not.toBe(0)
  })

  it('rejects a manifest with no channel at all', () => {
    const { code, stderr } = runOnManifest(
      (m) => {
        delete m.difyctl.channel
      },
      ['validate'],
    )
    expect(code).not.toBe(0)
    expect(stderr).toContain('unknown channel')
  })
})

describe('release-naming validate compat bounds', () => {
  const validateCompat = (minDify: string, maxDify: string) =>
    runWith({ compat: { minDify, maxDify } }, ['validate'])

  it('accepts a well-formed window', () => {
    expect(validateCompat('1.16.0', '1.17.0').code).toBe(0)
  })

  it('accepts equal bounds', () => {
    expect(validateCompat('1.17.0', '1.17.0').code).toBe(0)
  })

  it('rejects an inverted window', () => {
    const { code, stderr } = validateCompat('1.18.0', '1.17.0')
    expect(code).not.toBe(0)
    expect(stderr).toContain('is above maxDify')
  })

  it.each(['1.x', '1.*', '1.16', '1.16.0-rc1', 'latest', ''])('rejects %s as a bound', (bad) => {
    expect(validateCompat(bad, '2.9.0').code).not.toBe(0)
    expect(validateCompat('1.0.0', bad).code).not.toBe(0)
  })

  it('names the offending bound', () => {
    expect(validateCompat('1.x', '1.17.0').stderr).toContain('difyctl.compat.minDify')
    expect(validateCompat('1.16.0', '1.x').stderr).toContain('difyctl.compat.maxDify')
  })
})

describe('release-naming validate-version', () => {
  it('accepts build metadata on a stable version', () => {
    expect(run(['validate-version', '1.16.1+r2', 'stable']).code).toBe(0)
  })

  it('accepts an alpha version under the alpha channel, with or without a counter', () => {
    expect(run(['validate-version', '1.16.1-alpha', 'alpha']).code).toBe(0)
    expect(run(['validate-version', '1.16.1-alpha.2', 'alpha']).code).toBe(0)
  })
})
