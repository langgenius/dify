import type { SessionListResponse, SessionRow } from '@dify/contracts/api/openapi/types.gen'
import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { AccountSessionsClient } from '@/api/account-sessions'
import type { ActiveContext } from '@/auth/hosts'
import { useTempConfigDir } from '@test/fixtures/config-dir'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { MemStore } from '@test/fixtures/mem-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '@/auth/hosts'
import { bufferStreams } from '@/sys/io/streams'
import { listAllSessions, runDevicesList, runDevicesRevoke } from './devices.js'

function buildRegistry(host: string, email: string, tokenId: string): { reg: Registry, active: ActiveContext } {
  const reg = Registry.empty('file')
  reg.upsert(host, email, {
    account: { id: 'acct-1', email, name: 'Test Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    token_id: tokenId,
  })
  reg.setHost(host)
  reg.setAccount(email)
  const active = reg.resolveActive()!
  return { reg, active }
}

describe('runDevicesList', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('table: marks current with *', async () => {
    const io = bufferStreams()
    const http = testHttpClient(mock.url, 'dfoa_test')
    await runDevicesList({ io, tokenId: 'tok-1', http })
    const out = io.outBuf()
    expect(out).toContain('DEVICE')
    expect(out).toContain('difyctl on laptop')
    expect(out).toContain('difyctl on desktop')
    const lines = out.trim().split('\n')
    const laptopLine = lines.find(l => l.includes('difyctl on laptop'))!
    expect(laptopLine).toMatch(/\*\s*$/)
  })

  it('json: emits PaginationEnvelope unchanged', async () => {
    const io = bufferStreams()
    const http = testHttpClient(mock.url, 'dfoa_test')
    await runDevicesList({ io, tokenId: 'tok-1', http, json: true })
    const parsed = JSON.parse(io.outBuf()) as Record<string, unknown>
    expect(parsed.page).toBe(1)
    expect(Array.isArray(parsed.data)).toBe(true)
    expect((parsed.data as unknown[]).length).toBe(3)
  })
})

describe('runDevicesRevoke', () => {
  let mock: DifyMock
  useTempConfigDir('difyctl-devrevoke-')
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('exact device_label: revokes one + leaves local creds', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    await store.write(mock.url, 'tester@dify.ai', 'dfoa_test')
    await reg.save()
    const http = testHttpClient(mock.url, 'dfoa_test')

    await runDevicesRevoke({ io, reg, active, store, http, target: 'difyctl on desktop', all: false })
    expect(io.outBuf()).toContain('Revoked 1 session(s)')
    expect(store.entries.size).toBe(1)
  })

  it('exact id: revokes one', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    const http = testHttpClient(mock.url, 'dfoa_test')

    await runDevicesRevoke({ io, reg, active, store, http, target: 'tok-2', all: false })
    expect(io.outBuf()).toContain('Revoked 1 session(s)')
  })

  it('substring: unique match revokes', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    const http = testHttpClient(mock.url, 'dfoa_test')

    await runDevicesRevoke({ io, reg, active, store, http, target: 'web', all: false })
    expect(io.outBuf()).toContain('Revoked 1 session(s)')
  })

  it('substring: ambiguous throws', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    const http = testHttpClient(mock.url, 'dfoa_test')

    await expect(runDevicesRevoke({ io, reg, active, store, http, target: 'difyctl', all: false }))
      .rejects
      .toThrow(/matches multiple/)
  })

  it('no match throws', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    const http = testHttpClient(mock.url, 'dfoa_test')

    await expect(runDevicesRevoke({ io, reg, active, store, http, target: 'nonexistent', all: false }))
      .rejects
      .toThrow(/no session matches/)
  })

  it('--all: revokes everything except current', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    const http = testHttpClient(mock.url, 'dfoa_test')

    await runDevicesRevoke({ io, reg, active, store, http, all: true })
    expect(io.outBuf()).toContain('Revoked 2 session(s)')
  })

  it('revoking current session clears token and removes context from registry', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    await store.write(mock.url, 'tester@dify.ai', 'dfoa_test')
    await reg.save()
    const http = testHttpClient(mock.url, 'dfoa_test')

    await runDevicesRevoke({ io, reg, active, store, http, target: 'tok-1', all: false })
    expect(store.entries.size).toBe(0)
    const saved = await Registry.load()
    expect(saved?.hosts[mock.url]).toBeUndefined()
  })

  it('no target + no --all: throws UsageMissingArg', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const { reg, active } = buildRegistry(mock.url, 'tester@dify.ai', 'tok-1')
    const http = testHttpClient(mock.url, 'dfoa_test')
    await expect(runDevicesRevoke({ io, reg, active, store, http, all: false }))
      .rejects
      .toThrow(/specify a device label/)
  })
})

describe('listAllSessions', () => {
  const row = (id: string, label = `dev-${id}`): SessionRow => ({
    id,
    prefix: 'dfoa_xxx',
    client_id: 'difyctl',
    device_label: label,
    created_at: null,
    last_used_at: null,
    expires_at: null,
  })

  function stubClient(pages: readonly SessionListResponse[]): { client: AccountSessionsClient, list: ReturnType<typeof vi.fn> } {
    const list = vi.fn(async (q?: { page?: number, limit?: number }) => {
      const page = q?.page ?? 1
      const env = pages[page - 1]
      if (env === undefined)
        throw new Error(`stub: no page ${page}`)
      return env
    })
    return { client: { list } as unknown as AccountSessionsClient, list }
  }

  it('exhausts pages until has_more=false', async () => {
    const { client, list } = stubClient([
      { page: 1, limit: 200, total: 250, has_more: true, data: Array.from({ length: 200 }, (_, i) => row(`s-${i}`)) },
      { page: 2, limit: 200, total: 250, has_more: false, data: Array.from({ length: 50 }, (_, i) => row(`s-${200 + i}`)) },
    ])
    const all = await listAllSessions(client)
    expect(all.length).toBe(250)
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(1, { page: 1, limit: 200 })
    expect(list).toHaveBeenNthCalledWith(2, { page: 2, limit: 200 })
  })

  it('single page (has_more=false): one call', async () => {
    const { client, list } = stubClient([
      { page: 1, limit: 200, total: 3, has_more: false, data: [row('a'), row('b'), row('c')] },
    ])
    const all = await listAllSessions(client)
    expect(all.length).toBe(3)
    expect(list).toHaveBeenCalledTimes(1)
  })
})
