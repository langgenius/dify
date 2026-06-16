import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext } from '@/auth/hosts'
import { mkdtemp, rm } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { ENV_CONFIG_DIR } from '@/store/dir'
import { arch } from '@/sys/index'
import { runVersionProbe } from './probe'

function active(overrides: Partial<ActiveContext> = {}): ActiveContext {
  return {
    host: 'cloud.dify.ai',
    email: 'test@dify.ai',
    ctx: { account: { id: 'acct-1', email: 'test@dify.ai', name: 'Test' } },
    scheme: 'https',
    ...overrides,
  }
}

describe('runVersionProbe', () => {
  it('returns skipped server + unknown compat when skipServer=true', async () => {
    const report = await runVersionProbe({
      skipServer: true,
      loadActive: async () => active(),
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('')
    expect(report.compat.status).toBe('unknown')
    expect(report.compat.detail).toContain('skipped')
  })

  it('passes only the endpoint to probe (no bearer; /_version is unauth)', async () => {
    let observed: string | undefined
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => active(),
      probe: async (endpoint) => {
        observed = endpoint
        return { version: '1.6.4', edition: 'CLOUD' }
      },
    })

    expect(observed).toBe('https://cloud.dify.ai')
    expect(report.compat.status).toBe('compatible')
  })

  it('returns no-host + unknown compat when active context is missing', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => undefined,
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('')
    expect(report.compat.detail).toContain('no host')
  })

  it('returns no-host when active context has empty host', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => active({ host: '' }),
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.server.reachable).toBe(false)
    expect(report.compat.status).toBe('unknown')
  })

  it('distinguishes loadActive disk failure from no-host configured in the detail', async () => {
    const errReport = await runVersionProbe({
      skipServer: false,
      loadActive: async () => { throw new Error('disk-explode') },
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })
    expect(errReport.server.reachable).toBe(false)
    expect(errReport.server.endpoint).toBe('')
    expect(errReport.compat.detail).toContain('unreadable')

    const noHostReport = await runVersionProbe({
      skipServer: false,
      loadActive: async () => undefined,
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })
    expect(noHostReport.compat.detail).toContain('no host')
    expect(noHostReport.compat.detail).not.toContain('unreadable')
  })

  it('returns compatible report when server is reachable and in range', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => active(),
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
      loadActive: async () => active(),
      probe: async () => ({ version: '99.0.0', edition: 'SELF_HOSTED' }),
    })

    expect(report.server.reachable).toBe(true)
    expect(report.compat.status).toBe('unsupported')
  })

  it('returns unknown when server returns an empty version string', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => active(),
      probe: async (): Promise<ServerVersionResponse> => ({ version: '', edition: 'SELF_HOSTED' }),
    })

    expect(report.server.reachable).toBe(true)
    expect(report.compat.status).toBe('unknown')
  })

  it('treats probe rejection as unreachable + unknown compat', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => active(),
      probe: async () => { throw new Error('timeout') },
    })

    expect(report.server.reachable).toBe(false)
    expect(report.server.endpoint).toBe('https://cloud.dify.ai')
    expect(report.server.version).toBeUndefined()
    expect(report.compat.status).toBe('unknown')
    expect(report.compat.detail).toContain('unreachable')
  })

  it('builds endpoint using active scheme when host has no scheme', async () => {
    const report = await runVersionProbe({
      skipServer: false,
      loadActive: async () => active({ host: 'localhost:5001', scheme: 'http' }),
      probe: async () => ({ version: '1.6.4', edition: 'SELF_HOSTED' }),
    })

    expect(report.server.endpoint).toBe('http://localhost:5001')
  })

  it('default DI: reads hosts file + probes a real /_version end-to-end', async () => {
    // Integration sanity — no DI overrides. Resolves config dir from the
    // DIFY_CONFIG_DIR override, reads a real hosts.yml from disk, builds a
    // real ky client, and hits the dify-mock /openapi/v1/_version endpoint.
    const mock = await startMock()
    const configDir = await mkdtemp(join(tmpdir(), 'difyctl-probe-'))
    const url = new URL(mock.url)
    const prevConfig = process.env[ENV_CONFIG_DIR]
    try {
      process.env[ENV_CONFIG_DIR] = configDir
      const reg = Registry.empty('file')
      reg.upsert(url.host, 'test@dify.ai', { account: { id: 'acct-1', email: 'test@dify.ai', name: 'Test' } })
      reg.setHost(url.host)
      reg.setAccount('test@dify.ai')
      reg.setScheme(url.host, url.protocol.replace(':', ''))
      await reg.save()
      process.env[ENV_CONFIG_DIR] = configDir

      const report = await runVersionProbe({ skipServer: false })

      expect(report.server.reachable).toBe(true)
      expect(report.server.endpoint).toBe(mock.url)
      expect(report.server.version).toBe('1.6.4')
      expect(report.server.edition).toBe('CLOUD')
      expect(report.compat.status).toBe('compatible')
    }
    finally {
      if (prevConfig === undefined)
        delete process.env[ENV_CONFIG_DIR]
      else
        process.env[ENV_CONFIG_DIR] = prevConfig
      await mock.stop()
      await rm(configDir, { recursive: true, force: true })
    }
  })

  it('always includes client metadata in the report', async () => {
    const report = await runVersionProbe({
      skipServer: true,
      loadActive: async () => undefined,
      probe: async () => ({ version: '1.6.4', edition: 'CLOUD' }),
    })

    expect(report.client.version).toBeTypeOf('string')
    expect(report.client.commit).toBeTypeOf('string')
    expect(report.client.channel).toMatch(/^(dev|rc|stable)$/)
    expect(report.client.platform).toBe(platform())
    expect(report.client.arch).toBe(arch())
  })
})
