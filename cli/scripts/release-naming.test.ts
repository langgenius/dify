import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./release-naming.mjs', import.meta.url))

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

describe('release-naming compat-check (compat 1.16.0..1.16.0)', () => {
  it('accepts a version inside the window', () => {
    expect(run(['compat-check', '1.16.0']).code).toBe(0)
  })

  it('accepts the inclusive lower bound', () => {
    expect(run(['compat-check', '1.16.0']).code).toBe(0)
  })

  it('accepts the inclusive upper bound', () => {
    expect(run(['compat-check', '1.16.0']).code).toBe(0)
  })

  it('accepts a v-prefixed tag', () => {
    expect(run(['compat-check', 'v1.16.0']).code).toBe(0)
  })

  it('rejects a version below the lower bound', () => {
    expect(run(['compat-check', '1.15.9']).code).not.toBe(0)
  })

  it('rejects a version above the upper bound', () => {
    expect(run(['compat-check', '1.16.1']).code).not.toBe(0)
  })

  it('treats a prerelease of the bound as below it (1.16.0-rc1 < 1.16.0)', () => {
    expect(run(['compat-check', '1.16.0-rc1']).code).not.toBe(0)
  })

  it('ignores build metadata on the bound (1.16.0+build == 1.16.0)', () => {
    expect(run(['compat-check', '1.16.0+build123']).code).toBe(0)
  })

  it('ignores build metadata when out of range (1.16.1+build still rejected)', () => {
    expect(run(['compat-check', '1.16.1+build123']).code).not.toBe(0)
  })

  it('requires a version argument', () => {
    expect(run(['compat-check']).code).not.toBe(0)
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
