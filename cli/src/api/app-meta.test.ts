import type { DifyMock } from '../../test/fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMock } from '../../test/fixtures/dify-mock/server.js'
import { loadAppInfoCache } from '../cache/app-info.js'
import { createClient } from '../http/client.js'
import { CACHE_APP_INFO, cachePath } from '../store/manager.js'
import { YamlStore } from '../store/store.js'
import { FieldInfo, FieldParameters } from '../types/app-meta.js'
import { AppMetaClient } from './app-meta.js'
import { AppsClient } from './apps.js'

describe('AppMetaClient', () => {
  let mock: DifyMock
  let dir: string
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    dir = await mkdtemp(join(tmpdir(), 'difyctl-meta-'))
  })
  afterEach(async () => {
    await mock.stop()
    await rm(dir, { recursive: true, force: true })
  })

  it('cache miss → fetch → populate; warm hit skips network', async () => {
    const cache = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    const apps = new AppsClient(createClient({ host: mock.url, bearer: 'dfoa_test' }))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    const m1 = await client.get('app-1', 'ws-1', [FieldInfo])
    expect(m1.info?.id).toBe('app-1')
    expect(spy).toHaveBeenCalledTimes(1)

    const m2 = await client.get('app-1', 'ws-1', [FieldInfo])
    expect(m2.info?.id).toBe('app-1')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('slim hit + full request triggers fresh fetch + merges', async () => {
    const cache = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    const apps = new AppsClient(createClient({ host: mock.url, bearer: 'dfoa_test' }))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    await client.get('app-1', 'ws-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)

    const full = await client.get('app-1', 'ws-1', [FieldInfo, FieldParameters])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(full.coveredFields.has(FieldParameters)).toBe(true)
  })

  it('expired cache entry refetches', async () => {
    const cache = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)), ttlMs: 100, now: () => new Date('2026-05-09T00:00:00Z') })
    const apps = new AppsClient(createClient({ host: mock.url, bearer: 'dfoa_test' }))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache, now: () => new Date('2026-05-09T00:00:00Z') })

    await client.get('app-1', 'ws-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)

    const client2 = new AppMetaClient({ apps, host: mock.url, cache, now: () => new Date('2026-05-09T00:00:01Z') })
    await client2.get('app-1', 'ws-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('invalidate forces next get to fetch', async () => {
    const cache = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    const apps = new AppsClient(createClient({ host: mock.url, bearer: 'dfoa_test' }))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    await client.get('app-1', 'ws-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)

    await client.invalidate('app-1')
    await client.get('app-1', 'ws-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('no cache: each call hits network', async () => {
    const apps = new AppsClient(createClient({ host: mock.url, bearer: 'dfoa_test' }))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url })

    await client.get('app-1', 'ws-1', [FieldInfo])
    await client.get('app-1', 'ws-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
