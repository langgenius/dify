import type { DifyMock } from '../../../../../test/fixtures/dify-mock/server.js'
import type { HostsBundle } from '../../../../auth/hosts.js'
import type { TokenStore } from '../../../../auth/store.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from '../../../../../test/fixtures/dify-mock/server.js'
import { saveHosts } from '../../../../auth/hosts.js'
import { createClient } from '../../../../http/client.js'
import { bufferStreams } from '../../../../io/streams.js'
import { runDevicesList, runDevicesRevoke } from './devices.js'

class MemStore implements TokenStore {
  readonly entries = new Map<string, string>()
  async put(host: string, accountId: string, token: string): Promise<void> {
    this.entries.set(`${host}::${accountId}`, token)
  }

  async get(host: string, accountId: string): Promise<string | undefined> {
    return this.entries.get(`${host}::${accountId}`)
  }

  async delete(host: string, accountId: string): Promise<void> {
    this.entries.delete(`${host}::${accountId}`)
  }

  async list(host: string): Promise<readonly string[]> {
    const prefix = `${host}::`
    return Array.from(this.entries.keys()).filter(k => k.startsWith(prefix))
  }
}

function bundleFor(host: string, tokenId = 'tok-1'): HostsBundle {
  return {
    current_host: host,
    scheme: 'http',
    token_storage: 'file',
    token_id: tokenId,
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Other', role: 'normal' },
    ],
  }
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
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })
    await runDevicesList({ io, bundle: bundleFor(mock.url, 'tok-1'), http })
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
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })
    await runDevicesList({ io, bundle: bundleFor(mock.url), http, json: true })
    const parsed = JSON.parse(io.outBuf()) as Record<string, unknown>
    expect(parsed.page).toBe(1)
    expect(Array.isArray(parsed.data)).toBe(true)
    expect((parsed.data as unknown[]).length).toBe(3)
  })

  it('not-logged-in: throws NotLoggedIn', async () => {
    const io = bufferStreams()
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })
    await expect(runDevicesList({ io, bundle: undefined, http }))
      .rejects
      .toThrow(/not logged in/)
  })
})

describe('runDevicesRevoke', () => {
  let mock: DifyMock
  let configDir: string
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    configDir = await mkdtemp(join(tmpdir(), 'difyctl-devrevoke-'))
  })
  afterEach(async () => {
    await mock.stop()
    await rm(configDir, { recursive: true, force: true })
  })

  it('exact device_label: revokes one + leaves local creds', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    await store.put(b.current_host, 'acct-1', 'dfoa_test')
    await saveHosts(configDir, b)
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runDevicesRevoke({ configDir, io, bundle: b, http, store, target: 'difyctl on desktop', all: false })
    expect(io.outBuf()).toContain('Revoked 1 session(s)')
    expect(store.entries.size).toBe(1)
  })

  it('exact id: revokes one', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runDevicesRevoke({ configDir, io, bundle: b, http, store, target: 'tok-2', all: false })
    expect(io.outBuf()).toContain('Revoked 1 session(s)')
  })

  it('substring: unique match revokes', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runDevicesRevoke({ configDir, io, bundle: b, http, store, target: 'web', all: false })
    expect(io.outBuf()).toContain('Revoked 1 session(s)')
  })

  it('substring: ambiguous throws', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await expect(runDevicesRevoke({ configDir, io, bundle: b, http, store, target: 'difyctl', all: false }))
      .rejects
      .toThrow(/matches multiple/)
  })

  it('no match throws', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await expect(runDevicesRevoke({ configDir, io, bundle: b, http, store, target: 'nonexistent', all: false }))
      .rejects
      .toThrow(/no session matches/)
  })

  it('--all: revokes everything except current', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runDevicesRevoke({ configDir, io, bundle: b, http, store, all: true })
    expect(io.outBuf()).toContain('Revoked 2 session(s)')
  })

  it('revoking current id clears local creds', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const b = bundleFor(mock.url, 'tok-1')
    await store.put(b.current_host, 'acct-1', 'dfoa_test')
    await saveHosts(configDir, b)
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })

    await runDevicesRevoke({ configDir, io, bundle: b, http, store, target: 'tok-1', all: false })
    expect(store.entries.size).toBe(0)
    await expect(readFile(join(configDir, 'hosts.yml'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('no target + no --all: throws UsageMissingArg', async () => {
    const io = bufferStreams()
    const store = new MemStore()
    const http = createClient({ host: mock.url, bearer: 'dfoa_test' })
    await expect(runDevicesRevoke({ configDir, io, bundle: bundleFor(mock.url), http, store, all: false }))
      .rejects
      .toThrow(/specify a device label/)
  })
})
