import type { DifyMock } from '../../../../test/fixtures/dify-mock/server.js'
import type { HostsBundle } from '../../../auth/hosts.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from '../../../../test/fixtures/dify-mock/server.js'
import { loadAppInfoCache } from '../../../cache/app-info.js'
import { formatted, stringifyOutput } from '../../../framework/output.js'
import { createClient } from '../../../http/client.js'
import { CACHE_APP_INFO, cachePath } from '../../../store/manager.js'
import { YamlStore } from '../../../store/store.js'
import { runDescribeApp } from './run.js'

function bundle(): HostsBundle {
  return {
    current_host: 'http://localhost',
    token_storage: 'file',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 't@d.ai', name: 'T' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Other', role: 'normal' },
    ],
  }
}

describe('runDescribeApp', () => {
  let mock: DifyMock
  let dir: string
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    dir = await mkdtemp(join(tmpdir(), 'difyctl-desc-'))
  })
  afterEach(async () => {
    await mock.stop()
    await rm(dir, { recursive: true, force: true })
  })

  async function render(opts: Parameters<typeof runDescribeApp>[0]): Promise<string> {
    const cache = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    const data = await runDescribeApp(
      opts,
      { bundle: bundle(), http: createClient({ host: mock.url, bearer: 'dfoa_test' }), host: mock.url, cache },
    )
    return stringifyOutput(formatted({ format: opts.format ?? '', data }))
  }

  it('text: renders kubectl-describe-style for chat app', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Name:')
    expect(out).toContain('Greeter')
    expect(out).toContain('ID:')
    expect(out).toContain('app-1')
    expect(out).toContain('Mode:')
    expect(out).toContain('chat')
    expect(out).toContain('Service API:')
    expect(out).toContain('Tags:')
    expect(out).toContain('demo')
    expect(out).toContain('Description:')
    expect(out).toContain('Parameters:')
  })

  it('text: agent app shows Agent: true', async () => {
    const out = await render({ appId: 'app-4', workspace: 'ws-2' })
    expect(out).toContain('Agent:')
    expect(out).toContain('true')
  })

  it('json: passes through DescribeResponse-shaped meta', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    const parsed = JSON.parse(out) as { info: { id: string }, parameters: unknown }
    expect(parsed.info.id).toBe('app-1')
    expect(parsed.parameters).toBeDefined()
  })

  it('yaml: renders YAML', async () => {
    const out = await render({ appId: 'app-1', format: 'yaml' })
    expect(out).toContain('info:')
    expect(out).toContain('id: app-1')
  })

  it('refresh: bypasses cache', async () => {
    const cache = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    await runDescribeApp(
      { appId: 'app-1' },
      { bundle: bundle(), http: createClient({ host: mock.url, bearer: 'dfoa_test' }), host: mock.url, cache },
    )
    const before = cache.get(mock.url, 'app-1')
    expect(before).toBeDefined()
    await runDescribeApp(
      { appId: 'app-1', refresh: true },
      { bundle: bundle(), http: createClient({ host: mock.url, bearer: 'dfoa_test' }), host: mock.url, cache },
    )
    const after = cache.get(mock.url, 'app-1')
    expect(after?.fetchedAt).not.toBe(before?.fetchedAt ?? '')
  })

  it('rejects unknown format', async () => {
    await expect(render({ appId: 'app-1', format: 'bogus' })).rejects.toThrow(/not supported/)
  })

  it('unknown app id surfaces as error', async () => {
    await expect(runDescribeApp(
      { appId: 'nope' },
      {
        bundle: bundle(),
        http: createClient({ host: mock.url, bearer: 'dfoa_test', retryAttempts: 0 }),
        host: mock.url,
      },
    )).rejects.toThrow()
  })
})
