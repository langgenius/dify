import type { AppMeta } from '@/types/app-meta'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_APP_INFO, cachePath, getCache } from '@/store/manager'
import { platform } from '@/sys/index'
import { FieldInfo, FieldParameters } from '@/types/app-meta'
import { APP_INFO_TTL_MS, loadAppInfoCache } from './app-info'

function appInfoPath(dir: string): string {
  return cachePath(dir, CACHE_APP_INFO)
}

function metaInfoOnly(id = 'app-1'): AppMeta {
  return {
    info: {
      id,
      name: 'Greeter',
      description: '',
      mode: 'chat',
      updated_at: undefined,
      service_api_enabled: false,
      is_agent: false,
    },
    parameters: null,
    inputSchema: null,
    coveredFields: new Set([FieldInfo]),
  }
}

describe('app-info disk cache', () => {
  let dir: string
  let prevCacheDir: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-cache-'))
    prevCacheDir = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
  })
  afterEach(async () => {
    if (prevCacheDir === undefined)
      delete process.env[ENV_CACHE_DIR]
    else
      process.env[ENV_CACHE_DIR] = prevCacheDir
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips an entry across reloads', async () => {
    const c1 = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await c1.set('http://localhost:9999', 'app-1', metaInfoOnly())

    const c2 = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    const got = c2.get('http://localhost:9999', 'app-1')
    expect(got).toBeDefined()
    expect(got?.meta.info?.id).toBe('app-1')
    expect(got?.meta.coveredFields.has(FieldInfo)).toBe(true)
  })

  it('isFresh respects TTL', async () => {
    const now = new Date('2026-05-09T00:00:00Z')
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO), now: () => now })
    await c.set('h', 'app-1', metaInfoOnly())
    const r = c.get('h', 'app-1')
    expect(r).toBeDefined()
    expect(c.isFresh(r!, now)).toBe(true)
    expect(c.isFresh(r!, new Date(now.getTime() + APP_INFO_TTL_MS - 1))).toBe(true)
    expect(c.isFresh(r!, new Date(now.getTime() + APP_INFO_TTL_MS))).toBe(false)
    expect(c.isFresh(r!, new Date(now.getTime() + APP_INFO_TTL_MS + 60_000))).toBe(false)
  })

  it('keys by (host, app_id) — different hosts isolate', async () => {
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await c.set('h1', 'app-1', metaInfoOnly())
    expect(c.get('h2', 'app-1')).toBeUndefined()
    expect(c.get('h1', 'app-1')).toBeDefined()
  })

  it('delete removes entry from disk', async () => {
    const c1 = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await c1.set('h', 'app-1', metaInfoOnly())
    await c1.delete('h', 'app-1')

    const c2 = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    expect(c2.get('h', 'app-1')).toBeUndefined()
  })

  it('writes file with 0600 permission', async () => {
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await c.set('h', 'app-1', metaInfoOnly())
    const { stat } = await import('node:fs/promises')
    const s = await stat(appInfoPath(dir))
    if (platform() !== 'win32')
      expect(s.mode & 0o777).toBe(0o600)
  })

  it('missing cache file is not an error', async () => {
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    expect(c.get('h', 'app-1')).toBeUndefined()
  })

  it('corrupt cache file is treated as empty', async () => {
    await writeFile(appInfoPath(dir), ': : not valid yaml', 'utf8')
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    expect(c.get('h', 'app-1')).toBeUndefined()
  })

  it('drops a corrupt single entry but keeps valid siblings', async () => {
    // Seed a real serialized entry via set() — no hand-authored on-disk shape.
    const seed = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await seed.set('h', 'app-2', metaInfoOnly('app-2'))

    // Inject a corrupt sibling alongside the real one.
    const file = yaml.load(await readFile(appInfoPath(dir), 'utf8')) as { entries: Record<string, unknown> }
    file.entries['h::app-1'] = 'corrupted-string-not-object'
    await writeFile(appInfoPath(dir), yaml.dump(file), 'utf8')

    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    expect(c.get('h', 'app-1')).toBeUndefined()
    expect(c.get('h', 'app-2')?.meta.info?.id).toBe('app-2')
  })

  it('treats a non-object entries map as empty', async () => {
    await writeFile(appInfoPath(dir), yaml.dump({ entries: 'not-an-object' }), 'utf8')
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    expect(c.get('h', 'app-1')).toBeUndefined()
  })

  it('updates same key in place (no growth)', async () => {
    const c = await loadAppInfoCache({ store: getCache(CACHE_APP_INFO) })
    await c.set('h', 'app-1', metaInfoOnly())
    const slim: AppMeta = {
      ...metaInfoOnly(),
      coveredFields: new Set([FieldInfo, FieldParameters]),
      parameters: { opening_statement: 'hi' },
    }
    await c.set('h', 'app-1', slim)
    const raw = await readFile(appInfoPath(dir), 'utf8')
    const parsed = yaml.load(raw) as { entries: Record<string, unknown> }
    expect(Object.keys(parsed.entries)).toHaveLength(1)
  })
})
