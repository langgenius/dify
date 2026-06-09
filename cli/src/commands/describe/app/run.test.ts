import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ActiveContext } from '@/auth/hosts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '@/cache/app-info'
import { formatted, stringifyOutput } from '@/framework/output'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_APP_INFO, getCache } from '@/store/manager'
import { runDescribeApp } from './run.js'

function active(): ActiveContext {
  return {
    host: 'http://localhost',
    email: 't@d.ai',
    ctx: {
      account: { id: 'acct-1', email: 't@d.ai', name: 'T' },
      workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    },
  }
}

describe('runDescribeApp', () => {
  let mock: DifyMock
  let dir: string
  let prevCacheDir: string | undefined
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    dir = await mkdtemp(join(tmpdir(), 'difyctl-desc-'))
    prevCacheDir = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
  })
  afterEach(async () => {
    if (prevCacheDir === undefined)
      delete process.env[ENV_CACHE_DIR]
    else
      process.env[ENV_CACHE_DIR] = prevCacheDir
    await mock.stop()
    await rm(dir, { recursive: true, force: true })
  })

  async function render(opts: Parameters<typeof runDescribeApp>[0]): Promise<string> {
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const data = await runDescribeApp(
      opts,
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, cache },
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
    const out = await render({ appId: 'app-4', workspace: '00000000-0000-0000-0000-000000000002' })
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
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await runDescribeApp(
      { appId: 'app-1' },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, cache },
    )
    const before = cache.get(mock.url, 'app-1')
    expect(before).toBeDefined()
    await runDescribeApp(
      { appId: 'app-1', refresh: true },
      { active: active(), http: testHttpClient(mock.url, 'dfoa_test'), host: mock.url, cache },
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
        active: active(),
        http: testHttpClient(mock.url, { bearer: 'dfoa_test', retryAttempts: 0 }),
        host: mock.url,
      },
    )).rejects.toThrow()
  })
})
