import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./release-naming.mjs', import.meta.url))

function run(args: string[]): { code: number, stdout: string, stderr: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  }
  catch (e) {
    const err = e as { status?: number, stdout?: string, stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

describe('release-naming compat-check (compat 1.14.0..1.15.0)', () => {
  it('accepts a version inside the window', () => {
    expect(run(['compat-check', '1.14.7']).code).toBe(0)
  })

  it('accepts the inclusive lower bound', () => {
    expect(run(['compat-check', '1.14.0']).code).toBe(0)
  })

  it('accepts the inclusive upper bound', () => {
    expect(run(['compat-check', '1.15.0']).code).toBe(0)
  })

  it('accepts a v-prefixed tag', () => {
    expect(run(['compat-check', 'v1.14.2']).code).toBe(0)
  })

  it('rejects a version below the lower bound', () => {
    expect(run(['compat-check', '1.13.9']).code).not.toBe(0)
  })

  it('rejects a version above the upper bound', () => {
    expect(run(['compat-check', '1.15.1']).code).not.toBe(0)
  })

  it('treats a prerelease of the upper bound as in range (1.15.0-rc1 <= 1.15.0)', () => {
    expect(run(['compat-check', '1.15.0-rc1']).code).toBe(0)
  })

  it('treats a prerelease of the lower bound as below it (1.14.0-rc1 < 1.14.0)', () => {
    expect(run(['compat-check', '1.14.0-rc1']).code).not.toBe(0)
  })

  it('ignores build metadata on the upper bound (1.15.0+build == 1.15.0)', () => {
    expect(run(['compat-check', '1.15.0+build123']).code).toBe(0)
  })

  it('ignores build metadata when out of range (1.15.1+build still rejected)', () => {
    expect(run(['compat-check', '1.15.1+build123']).code).not.toBe(0)
  })

  it('requires a version argument', () => {
    expect(run(['compat-check']).code).not.toBe(0)
  })
})

describe('release-naming github-env', () => {
  it('emits difyctlTag = tagPrefix + version', () => {
    const { stdout } = run(['github-env'])
    expect(stdout).toMatch(/^difyctlTag=difyctl-v0\.1\.0-rc\.1$/m)
  })

  it('still emits the existing trace fields', () => {
    const { stdout } = run(['github-env'])
    for (const key of ['version', 'channel', 'prerelease', 'minDify', 'maxDify', 'tagPrefix'])
      expect(stdout).toMatch(new RegExp(`^${key}=`, 'm'))
  })
})
