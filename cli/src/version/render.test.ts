import type { VersionReport } from './probe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderVersionText } from './render'

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

// Regex matching the ANSI CSI introducer (ESC `[`).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[/

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

  it('color=false produces no ANSI escape sequences regardless of TTY state', () => {
    const report: VersionReport = {
      client: baseClient({ channel: 'rc' }),
      server: { endpoint: 'https://cloud.dify.ai', reachable: true, version: '99.0.0', edition: 'SELF_HOSTED' },
      compat: {
        minDify: '1.6.0',
        maxDify: '1.7.0',
        status: 'unsupported',
        detail: 'server 99.0.0 outside [1.6.0, 1.7.0]',
      },
    }
    const plain = renderVersionText(report, { color: false })
    // Negative-side proof: every code path that could colorize (verdict +
    // RC warning) ran, yet the output is byte-clean.
    expect(plain).not.toMatch(ANSI_RE)
    expect(plain).toContain('Compatibility: incompatible')
    expect(plain).toContain('WARNING: This build is a release candidate')
  })

  describe('with picocolors stubbed to always emit ANSI', () => {
    // picocolors caches its capability detection at module load, so vitest
    // env-var tricks don't change its behavior at runtime. Instead, stub the
    // module to return real ANSI-wrapped strings — this proves the color=true
    // path actually routes through the colorizer (otherwise the marker is absent).
    beforeEach(() => {
      vi.resetModules()
      vi.doMock('picocolors', () => ({
        default: {
          yellow: (s: string) => `[33m${s}[39m`,
          dim: (s: string) => `[2m${s}[22m`,
          green: (s: string) => `[32m${s}[39m`,
          red: (s: string) => `[31m${s}[39m`,
          bold: (s: string) => `[1m${s}[22m`,
          cyan: (s: string) => `[36m${s}[39m`,
          magenta: (s: string) => `[35m${s}[39m`,
        },
      }))
    })
    afterEach(() => {
      vi.doUnmock('picocolors')
      vi.resetModules()
    })

    it('color=true emits ANSI sequences for verdict and RC warning lines', async () => {
      const { renderVersionText: render } = await import('./render')
      const report: VersionReport = {
        client: baseClient({ channel: 'rc' }),
        server: { endpoint: 'https://cloud.dify.ai', reachable: true, version: '99.0.0', edition: 'SELF_HOSTED' },
        compat: {
          minDify: '1.6.0',
          maxDify: '1.7.0',
          status: 'unsupported',
          detail: 'server 99.0.0 outside [1.6.0, 1.7.0]',
        },
      }
      const colored = render(report, { color: true })
      expect(colored).toMatch(ANSI_RE)
      expect(colored).toContain('Compatibility: incompatible')
      // RC warning lines also routed through yellow.
      expect(colored).toContain('release candidate')
    })
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
