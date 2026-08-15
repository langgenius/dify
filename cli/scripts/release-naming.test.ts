import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { FIXTURE_COMPAT, pkgManifestEnv } from '../test/fixtures/pkg-manifest'

const SCRIPT = fileURLToPath(new URL('./release-naming.mjs', import.meta.url))

function run(
  args: string[],
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

describe('release-naming compat-check', () => {
  const { minDify, maxDify } = FIXTURE_COMPAT // 2.0.0 .. 2.5.0
  const pkgEnv = pkgManifestEnv()
  const compatCheck = (difyVersion?: string) =>
    run(difyVersion === undefined ? ['compat-check'] : ['compat-check', difyVersion], pkgEnv).code

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
})

describe('release-naming github-env', () => {
  it('emits difyctlTag = tagPrefix + version', () => {
    const { stdout } = run(['github-env'])
    expect(stdout).toMatch(/^difyctlTag=difyctl-v0\.2\.0-alpha$/m)
  })

  it('still emits the existing trace fields', () => {
    const { stdout } = run(['github-env'])
    for (const key of ['version', 'channel', 'prerelease', 'minDify', 'maxDify', 'tagPrefix'])
      expect(stdout).toMatch(new RegExp(`^${key}=`, 'm'))
  })

  // The only assertion against the live manifest: the window must exist and be
  // well-formed, whatever release it currently points at.
  it('emits a well-formed compat window from the real cli/package.json', () => {
    const { stdout } = run(['github-env'])
    expect(stdout).toMatch(/^minDify=\d+\.\d+\.\d+$/m)
    expect(stdout).toMatch(/^maxDify=\d+\.\d+\.\d+$/m)
  })
})

describe('release-naming edge channel', () => {
  it('lists edge among channels', () => {
    expect(run(['channels']).stdout).toMatch(/^edge$/m)
  })

  it('edge-version derives <pkgcore>-edge.<sha> from the package version', () => {
    // package.json version is 0.2.0-alpha -> core 0.2.0
    expect(run(['edge-version', '2fd7b82']).stdout.trim()).toBe('0.2.0-edge.2fd7b82')
  })

  it('edge-version accepts a 40-char sha', () => {
    const sha = '2fd7b829e1f0aaaabbbbccccddddeeeeffff0000'
    expect(run(['edge-version', sha]).stdout.trim()).toBe(`0.2.0-edge.${sha}`)
  })

  it('edge-version rejects a non-hex sha', () => {
    expect(run(['edge-version', 'nothex!']).code).not.toBe(0)
  })

  it('edge-version requires a sha argument', () => {
    expect(run(['edge-version']).code).not.toBe(0)
  })

  it('the edge version form matches a computed edge version', () => {
    expect(run(['validate-version', '0.1.0-edge.2fd7b82', 'edge']).code).toBe(0)
  })

  it('validate-version rejects an rc string under the edge channel', () => {
    expect(run(['validate-version', '0.1.0-rc.1', 'edge']).code).not.toBe(0)
  })
})
