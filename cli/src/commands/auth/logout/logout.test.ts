import type { DifyMock } from '../../../../test/fixtures/dify-mock/server.js'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { Key, Store } from '../../../store/store.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from '../../../../test/fixtures/dify-mock/server.js'
import { saveHosts } from '../../../auth/hosts.js'
import { createClient } from '../../../http/client.js'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { tokenKey } from '../../../store/manager.js'
import { bufferStreams } from '../../../sys/io/streams'
import { runLogout } from './logout.js'

class MemStore implements Store {
  readonly entries = new Map<string, unknown>()
  get<T>(key: Key<T>): T {
    return (this.entries.get(key.key) as T | undefined) ?? key.default
  }

  set<T>(key: Key<T>, value: T): void {
    this.entries.set(key.key, value)
  }

  unset<T>(key: Key<T>): void {
    this.entries.delete(key.key)
  }
}

function fixtureBundle(host: string): HostsBundle {
  return {
    current_host: host,
    scheme: 'http',
    token_storage: 'file',
    token_id: 'tok-1',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Other', role: 'normal' },
    ],
  }
}

describe('runLogout', () => {
  let mock: DifyMock
  let configDir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    configDir = await mkdtemp(join(tmpdir(), 'difyctl-logout-'))
    prevConfigDir = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = configDir
  })

  afterEach(async () => {
    if (prevConfigDir === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else
      process.env[ENV_CONFIG_DIR] = prevConfigDir
    await mock.stop()
    await rm(configDir, { recursive: true, force: true })
  })

  it('happy: revokes server side, clears local store + hosts.yml', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = fixtureBundle(mock.url)
    store.set(tokenKey(bundle.current_host, 'acct-1'), 'dfoa_test')
    saveHosts(bundle)
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runLogout({ io, bundle, http, store })

    expect(store.entries.size).toBe(0)
    await expect(readFile(join(configDir, 'hosts.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
    expect(io.outBuf()).toContain('Logged out of')
    expect(io.errBuf()).toBe('')
  })

  it('not-logged-in: throws BaseError', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    await expect(runLogout({ io, bundle: undefined, store })).rejects.toThrow(/not logged in/)
  })

  it('hosts.yml absent: still completes locally + emits success', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = fixtureBundle(mock.url)
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runLogout({ io, bundle, http, store })

    expect(io.outBuf()).toContain('Logged out of')
  })

  it('server revoke fails: warns to stderr but still clears local + exits 0', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = fixtureBundle(mock.url)
    store.set(tokenKey(bundle.current_host, 'acct-1'), 'dfoa_test')
    saveHosts(bundle)
    mock.setScenario('server-5xx')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test', retryAttempts: 0 })

    await runLogout({ io, bundle, http, store })

    expect(store.entries.size).toBe(0)
    expect(io.errBuf()).toContain('server revoke failed')
    expect(io.outBuf()).toContain('Logged out of')
  })

  it('skips server revoke for non-OAuth bearer (e.g. dfp_)', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = fixtureBundle(mock.url)
    bundle.tokens = { bearer: 'dfp_personal_token' }
    store.set(tokenKey(bundle.current_host, 'acct-1'), 'dfp_personal_token')
    saveHosts(bundle)
    const http = createClient({ host: mock.url, bearer: 'dfp_personal_token' })

    await runLogout({ io, bundle, http, store })

    expect(io.errBuf()).toBe('')
    expect(store.entries.size).toBe(0)
  })

  it('preserves unrelated files in configDir', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = fixtureBundle(mock.url)
    saveHosts(bundle)
    await writeFile(join(configDir, 'config.yml'), 'foo: bar\n', 'utf8')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runLogout({ io, bundle, http, store })

    const cfg = await readFile(join(configDir, 'config.yml'), 'utf8')
    expect(cfg).toContain('foo: bar')
  })
})
