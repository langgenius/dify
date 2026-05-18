import type { VersionReport } from './probe.js'
import { describe, expect, it } from 'vitest'
import { renderVersionText } from './render.js'

function baseClient(overrides: Partial<VersionReport['client']> = {}): VersionReport['client'] {
  return {
    version: '0.1.0-rc.1',
    commit: '2fd7b82970abcdef',
    buildDate: '2026-05-18T00:00:00Z',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    ...overrides,
  }
}

function compatible(): VersionReport['compat'] {
  return {
    minDify: '1.6.0',
    maxDify: '1.7.0',
    status: 'compatible',
    detail: 'server 1.6.4 in [1.6.0, 1.7.0]',
  }
}

describe('renderVersionText', () => {
  it('renders all three blocks for a reachable, compatible server', () => {
    const report: VersionReport = {
      client: baseClient(),
      server: { endpoint: 'https://cloud.dify.ai', reachable: true, version: '1.6.4', edition: 'CLOUD' },
      compat: compatible(),
    }
    const text = renderVersionText(report)

    expect(text).toContain('Client:')
    expect(text).toContain('Version:   0.1.0-rc.1 (channel: stable)')
    expect(text).toContain('Commit:    2fd7b82')
    expect(text).toContain('Platform:  darwin/arm64')
    expect(text).toContain('Compat:    dify >=1.6.0, <=1.7.0')

    expect(text).toContain('Server:')
    expect(text).toContain('Endpoint:  https://cloud.dify.ai')
    expect(text).toContain('Version:   1.6.4 (cloud)')

    expect(text).toContain('Compatibility: ok')
    expect(text).toContain('server 1.6.4 in [1.6.0, 1.7.0]')

    expect(text).not.toContain('WARNING:')
  })

  it('appends RC warning when channel is rc', () => {
    const report: VersionReport = {
      client: baseClient({ channel: 'rc' }),
      server: { endpoint: '', reachable: false },
      compat: { ...compatible(), status: 'unknown', detail: 'server probe skipped' },
    }
    const text = renderVersionText(report)

    expect(text).toContain('WARNING: This build is a release candidate')
    expect(text).toContain('install the stable channel')
  })

  it('shows "(skipped …)" when server.endpoint is empty', () => {
    const report: VersionReport = {
      client: baseClient(),
      server: { endpoint: '', reachable: false },
      compat: { ...compatible(), status: 'unknown', detail: 'server probe skipped' },
    }
    const text = renderVersionText(report)

    expect(text).toContain('(skipped — no host configured or --client passed)')
    expect(text).not.toContain('Endpoint:  ')
    expect(text).toContain('Compatibility: unknown')
  })

  it('shows "(unreachable)" when endpoint is set but reachable=false', () => {
    const report: VersionReport = {
      client: baseClient(),
      server: { endpoint: 'https://cloud.dify.ai', reachable: false },
      compat: { ...compatible(), status: 'unknown', detail: 'server unreachable' },
    }
    const text = renderVersionText(report)

    expect(text).toContain('Endpoint:  https://cloud.dify.ai')
    expect(text).toContain('Version:   (unreachable)')
  })

  it('always contains the verdict line on unsupported, regardless of color toggle', () => {
    // picocolors no-ops escape sequences when stdout is not a TTY, which is
    // the case under vitest, so the colored output may not actually include
    // ANSI codes. We only assert that the rendered text is well-formed in
    // both modes — the color path running without error is the real test.
    const report: VersionReport = {
      client: baseClient(),
      server: { endpoint: 'https://cloud.dify.ai', reachable: true, version: '99.0.0', edition: 'SELF_HOSTED' },
      compat: {
        minDify: '1.6.0',
        maxDify: '1.7.0',
        status: 'unsupported',
        detail: 'server 99.0.0 outside [1.6.0, 1.7.0]',
      },
    }
    const colored = renderVersionText(report, { color: true })
    const plain = renderVersionText(report, { color: false })

    for (const out of [colored, plain]) {
      expect(out).toContain('Compatibility: incompatible')
      expect(out).toContain('outside [1.6.0, 1.7.0]')
    }
  })

  it('terminates output with a trailing newline', () => {
    const report: VersionReport = {
      client: baseClient(),
      server: { endpoint: '', reachable: false },
      compat: { ...compatible(), status: 'unknown', detail: 'x' },
    }
    expect(renderVersionText(report).endsWith('\n')).toBe(true)
  })
})
