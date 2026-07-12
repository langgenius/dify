import type { DifyMock } from '@test/fixtures/dify-mock/server'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { dump, load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAppInfoCache } from '@/cache/app-info'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_APP_INFO, cachePath, getCache } from '@/store/manager'
import { FieldInfo, FieldParameters } from '@/types/app-meta'
import { AppMetaClient } from './app-meta.js'
import { AppsClient } from './apps.js'

describe('AppMetaClient', () => {
  let mock: DifyMock
  let dir: string
  let prevCacheDir: string | undefined
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
    dir = await mkdtemp(join(tmpdir(), 'difyctl-meta-'))
    prevCacheDir = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
  })
  afterEach(async () => {
    if (prevCacheDir === undefined) delete process.env[ENV_CACHE_DIR]
    else process.env[ENV_CACHE_DIR] = prevCacheDir
    await mock.stop()
    await rm(dir, { recursive: true, force: true })
  })

  it('cache miss → fetch → populate; warm hit skips network', async () => {
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const apps = new AppsClient(testHttpClient(mock.url, 'dfoa_test'))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    const m1 = await client.get('app-1', [FieldInfo])
    expect(m1.info?.id).toBe('app-1')
    expect(spy).toHaveBeenCalledTimes(1)

    const m2 = await client.get('app-1', [FieldInfo])
    expect(m2.info?.id).toBe('app-1')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('slim hit + full request triggers fresh fetch + merges', async () => {
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const apps = new AppsClient(testHttpClient(mock.url, 'dfoa_test'))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    await client.get('app-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)

    const full = await client.get('app-1', [FieldInfo, FieldParameters])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(full.coveredFields.has(FieldParameters)).toBe(true)
  })

  it('expired cache entry refetches', async () => {
    const cache = await loadAppInfoCache({
      store: getCache(CACHE_APP_INFO),
      ttlMs: 100,
      now: () => new Date('2026-05-09T00:00:00Z'),
    })
    const apps = new AppsClient(testHttpClient(mock.url, 'dfoa_test'))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({
      apps,
      host: mock.url,
      cache,
      now: () => new Date('2026-05-09T00:00:00Z'),
    })

    await client.get('app-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)

    const client2 = new AppMetaClient({
      apps,
      host: mock.url,
      cache,
      now: () => new Date('2026-05-09T00:00:01Z'),
    })
    await client2.get('app-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('invalidate forces next get to fetch', async () => {
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const apps = new AppsClient(testHttpClient(mock.url, 'dfoa_test'))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    await client.get('app-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)

    await client.invalidate('app-1')
    await client.get('app-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('no cache: each call hits network', async () => {
    const apps = new AppsClient(testHttpClient(mock.url, 'dfoa_test'))
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url })

    await client.get('app-1', [FieldInfo])
    await client.get('app-1', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('corrupt cache entry refetches; valid sibling stays cached; no throw', async () => {
    const path = cachePath(dir, CACHE_APP_INFO)
    const apps = new AppsClient(testHttpClient(mock.url, 'dfoa_test'))

    // Seed a real, production-serialized entry by fetching app-1 once (this
    // calls cache.set → serialize, so we never hand-write the on-disk shape).
    const seed = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await new AppMetaClient({ apps, host: mock.url, cache: seed }).get('app-1', [FieldInfo])

    // Reuse that serialized entry as a valid sibling; corrupt the app-1 slot.
    const file = load(await readFile(path, 'utf8')) as { entries: Record<string, unknown> }
    const validEntry = file.entries[`${mock.url}::app-1`]
    await writeFile(
      path,
      dump({
        entries: {
          [`${mock.url}::app-1`]: 'corrupted-string',
          [`${mock.url}::sibling`]: validEntry,
        },
      }),
      'utf8',
    )

    // Reload: app-1 dropped, sibling kept.
    const cache = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const spy = vi.spyOn(apps, 'describe')
    const client = new AppMetaClient({ apps, host: mock.url, cache })

    // app-1 corrupt → dropped → miss → refetched from the mock
    const a = await client.get('app-1', [FieldInfo])
    expect(a.info?.id).toBe('app-1')
    expect(spy).toHaveBeenCalledTimes(1)

    // sibling is the real serialized entry → served from cache, no network
    await client.get('sibling', [FieldInfo])
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
