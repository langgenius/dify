import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { Clock } from './device-flow.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useTempConfigDir } from '@test/fixtures/config-dir'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { MemStore } from '@test/fixtures/mem-store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceFlowApi } from '@/api/oauth-device'
import { createHttpClient } from '@/http/client'
import { bufferStreams } from '@/sys/io/streams'
import { openAPIBase } from '@/util/host'
import { runLogin } from './login.js'

const noopClock: Clock = {
  sleepMs: async () => { /* immediate */ },
  isCancelled: () => false,
}

const noopBrowser = async (): Promise<void> => { /* skip OS open */ }

describe('runLogin', () => {
  let mock: DifyMock
  const configDir = useTempConfigDir('difyctl-login-')

  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })

  afterEach(async () => {
    await mock.stop()
  })

  it('happy: stores bearer + writes hosts.yml + greets account user', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const reg = await runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(testHttpClient(mock.url)),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    const active = reg.resolveActive()
    expect(active?.ctx.account.email).toBe('tester@dify.ai')
    expect(active?.ctx.workspace?.id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(store.read(active!.host, 'tester@dify.ai')).toBe('dfoa_test')

    const hostsRaw = await readFile(join(configDir(), 'hosts.yml'), 'utf8')
    expect(hostsRaw).toContain('current_host:')
    expect(hostsRaw).toContain('tester@dify.ai')
    expect(hostsRaw).not.toContain('dfoa_test')
    expect(hostsRaw).not.toContain('bearer')

    expect(io.outBuf()).toContain('Logged in to')
    expect(io.outBuf()).toContain('tester@dify.ai')
    expect(io.outBuf()).toContain('Default')
    expect(io.errBuf()).toContain('ABCD-1234')
  })

  it('sso: stores dfoe_ token + greets external SSO subject (no account)', async () => {
    mock.setScenario('sso')
    const io = bufferStreams()
    const store = new MemStore()
    const reg = await runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(testHttpClient(mock.url)),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    const active = reg.resolveActive()
    expect(active?.ctx.external_subject?.email).toBe('sso@dify.ai')
    expect(active?.ctx.external_subject?.issuer).toBe('https://issuer.example')
    expect(active?.ctx.account.email).toBe('')
    expect(store.read(active!.host, 'sso@dify.ai')).toBe('dfoe_test')
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
      api: new DeviceFlowApi(testHttpClient(mock.url)),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })).rejects.toThrow(/denied/)
    expect(store.entries.size).toBe(0)
    await expect(readFile(join(configDir(), 'hosts.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
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
      api: new DeviceFlowApi(testHttpClient(mock.url)),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })).rejects.toThrow(/expired/)
  })

  it('rejects login when the account has no email', async () => {
    mock.setScenario('no-email')
    const io = bufferStreams()
    const store = new MemStore()
    await expect(runLogin({
      io,
      host: mock.url,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(createHttpClient({ baseURL: openAPIBase(mock.url) })),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })).rejects.toThrow(/no email/i)
    expect(store.entries.size).toBe(0)
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
      api: new DeviceFlowApi(testHttpClient(mock.url)),
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
      api: new DeviceFlowApi(testHttpClient(mock.url)),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    expect(io.errBuf()).toContain('--no-browser requested')
  })

  it('TTY: prompts for host when --host omitted, uses typed URL', async () => {
    const io = bufferStreams(`${mock.url}\n`)
    ;(io as { isErrTTY: boolean }).isErrTTY = true
    const store = new MemStore()
    const reg = await runLogin({
      io,
      noBrowser: true,
      insecure: true,
      deviceLabel: 'difyctl on test',
      api: new DeviceFlowApi(testHttpClient(mock.url)),
      store: { store, mode: 'file' },
      clock: noopClock,
      browserOpener: noopBrowser,
    })
    expect(reg.resolveActive()?.ctx.account.email).toBe('tester@dify.ai')
    expect(io.errBuf()).toContain('Enter Dify host URL')
    expect(io.errBuf()).toContain('[default: https://cloud.dify.ai]')
  })
})
