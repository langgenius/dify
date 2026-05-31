import type { DifyMock } from '../../../../test/fixtures/dify-mock/server.js'
import type { Key, Store } from '../../../store/store.js'
import type { Clock } from './device-flow.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from '../../../../test/fixtures/dify-mock/server.js'
import { DeviceFlowApi } from '../../../api/oauth-device.js'
import { createClient } from '../../../http/client.js'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { tokenKey } from '../../../store/manager.js'
import { bufferStreams } from '../../../sys/io/streams'
import { runLogin } from './login.js'

const noopClock: Clock = {
  sleepMs: async () => { /* immediate */ },
  isCancelled: () => false,
}

const noopBrowser = async (): Promise<void> => { /* skip OS open */ }

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

describe('runLogin', () => {
  let mock: DifyMock
  let configDir: string
  let prevConfigDir: string | undefined

  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    configDir = await mkdtemp(join(tmpdir(), 'difyctl-login-'))
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

  it('happy: stores bearer + writes hosts.yml + greets account user', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = await runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createClient({ host: mock.url })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    expect(bundle.tokens?.bearer).toBe('dfoa_test')
    expect(bundle.account?.email).toBe('tester@dify.ai')
    expect(bundle.workspace?.id).toBe('ws-1')
    expect(bundle.available_workspaces).toHaveLength(2)
    const stored = store.get(tokenKey(bundle.current_host, 'acct-1'))
    expect(stored).toBe('dfoa_test')

    const hostsRaw = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsRaw).toContain('current_host:')
    expect(hostsRaw).toContain('tester@dify.ai')

    expect(io.outBuf()).toContain('Logged in to')
    expect(io.outBuf()).toContain('tester@dify.ai')
    expect(io.outBuf()).toContain('Default')
    expect(io.errBuf()).toContain('ABCD-1234')
  })

  it('sso: stores dfoe_ token + greets external SSO subject (no account)', async () => {
    mock.setScenario('sso')
    const io = bufferStreams()
    const store = new MemStore()
    const bundle = await runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createClient({ host: mock.url })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    expect(bundle.tokens?.bearer).toBe('dfoe_test')
    expect(bundle.account).toBeUndefined()
    expect(bundle.external_subject?.email).toBe('sso@dify.ai')
    expect(bundle.external_subject?.issuer).toBe('https://issuer.example')
    const stored = await store.get(bundle.current_host, 'sso@dify.ai')
    expect(stored).toBe('dfoe_test')
    expect(io.outBuf()).toContain('external SSO')
    expect(io.outBuf()).toContain('sso@dify.ai')
  })

  it('denied: throws DeviceFlowError + leaves config dir empty', async () => {
    mock.setScenario('denied')
    const io = bufferStreams()
    const store = new MemStore()
    await expect(runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createClient({ host: mock.url })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })).rejects.toThrow(/denied/)
    expect(store.entries.size).toBe(0)
    await expect(readFile(join(configDir, 'hosts.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('expired: throws DeviceFlowError', async () => {
    mock.setScenario('expired')
    const io = bufferStreams()
    const store = new MemStore()
    await expect(runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createClient({ host: mock.url })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })).rejects.toThrow(/expired/)
  })

  it('rejects http:// host without --insecure', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    await expect(runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: false,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createClient({ host: mock.url })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })).rejects.toThrow(/https:\/\//)
  })

  it('emits skip-reason to stderr when --no-browser', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    await runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createClient({ host: mock.url })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    expect(io.errBuf()).toContain('--no-browser requested')
  })
})
