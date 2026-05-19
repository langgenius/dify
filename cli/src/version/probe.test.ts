import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HostsBundle } from '../auth/hosts.js'
import { describe, expect, it } from 'vitest'
import { runVersionProbe } from './probe.js'

function bundle(overrides: Partial<HostsBundle> = {}): HostsBundle {
  return {
    current_host: 'cloud.dify.ai',
    scheme: 'https',
    token_storage: 'file',
    tokens: { bearer: 'dfoa_test' },
    ...overrides,
  } as HostsBundle
}

describe('runVersionProbe', () => {
  it('returns skipped server + unknown compat when skipServer=true', async () => {
    const report = await runVersionProbe({
      skipServer: true,
      loadBundle: async () => bundle(),
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('')
    expect(report.compat.status).toBe('unknown')
    expect(report.compat.detail).toContain('skipped')
  })

  it('returns no-host + unknown compat when bundle is missing', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => undefined,
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('')
    expect(report.compat.detail).toContain('no host')
  })

  it('returns no-host when bundle has empty current_host', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => bundle({ current_host: '' }),
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.compat.status).toBe('unknown')
  })

  it('treats loadBundle throwing as no-host', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => { throw new Error('disk-explode') },
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('')
  })

  it('returns compatible report when server is reachable and in range', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => bundle(),
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(true)
    expect(report.server.endpoint).toBe('https://cloud.dify.ai')
    expect(report.server.version).toBe('1.6.4')
    expect(report.server.edition).toBe('CLOUD')
    expect(report.compat.status).toBe('compatible')
  })

  it('returns unsupported when server version is out of range', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => bundle(),
      probe: async () => ({ version: '99.0.0', edition: 'SELF_HOSTED' }),
    })

    expect(report.server.reachable).toBe(true)
    expect(report.compat.status).toBe('unsupported')
  })

  it('returns unknown when server returns an empty version string', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => bundle(),
      probe: async (): Promise<ServerVersionResponse> => ({ version: '', edition: 'SELF_HOSTED' }),
    })

    expect(report.server.reachable).toBe(true)
    expect(report.compat.status).toBe('unknown')
  })

  it('treats probe rejection as unreachable + unknown compat', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => bundle(),
      probe: async () => { throw new Error('timeout') },
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('https://cloud.dify.ai')
    expect(report.server.version).toBeUndefined()
    expect(report.compat.status).toBe('unknown')
    expect(report.compat.detail).toContain('unreachable')
  })

  it('builds endpoint using bundle scheme when host has no scheme', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadBundle: async () => bundle({ current_host: 'localhost:5001', scheme: 'http' }),
      probe: async () => ({ version: '1.6.4', edition: 'SELF_HOSTED' }),
    })

    expect(report.server.endpoint).toBe('http://localhost:5001')
  })

  it('always includes client metadata in the report', async () => {
    const report = await runVersionProbe({
      skipServer: true,
      loadBundle: async () => undefined,
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.client.version).toBeTypeOf('string')
    expect(report.client.commit).toBeTypeOf('string')
    expect(report.client.channel).toMatch(/^(dev|rc|stable)$/)
    expect(report.client.platform).toBe(process.platform)
    expect(report.client.arch).toBe(process.arch)
  })
})
