import type { AppMeta } from '../types/app-meta.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CACHE_APP_INFO, cachePath } from '../store/manager.js'
import { YamlStore } from '../store/store.js'
import { platform } from '../sys/index.js'
import { FieldInfo, FieldParameters } from '../types/app-meta.js'
import { APP_INFO_TTL_MS, loadAppInfoCache } from './app-info.js'

function appInfoPath(dir: string): string {
  return cachePath(dir, CACHE_APP_INFO)
}

function metaInfoOnly(): AppMeta {
  return {
    info: {
      id: 'app-1',
      name: 'Greeter',
      description: '',
      mode: 'chat',
      author: 'tester',
      tags: [],
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
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-cache-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips an entry across reloads', async () => {
    const c1 = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    await c1.set('http://localhost:9999', 'app-1', metaInfoOnly())

    const c2 = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    const got = c2.get('http://localhost:9999', 'app-1')
    expect(got).toBeDefined()
    expect(got?.meta.info?.id).toBe('app-1')
    expect(got?.meta.coveredFields.has(FieldInfo)).toBe(true)
  })

  it('isFresh respects TTL', async () => {
    const now = new Date('2026-05-09T00:00:00Z')
    const c = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)), now: () => now })
    await c.set('h', 'app-1', metaInfoOnly())
    const r = c.get('h', 'app-1')
    expect(r).toBeDefined()
    expect(c.isFresh(r!, now)).toBe(true)
    expect(c.isFresh(r!, new Date(now.getTime() + APP_INFO_TTL_MS - 1))).toBe(true)
    expect(c.isFresh(r!, new Date(now.getTime() + APP_INFO_TTL_MS))).toBe(false)
    expect(c.isFresh(r!, new Date(now.getTime() + APP_INFO_TTL_MS + 60_000))).toBe(false)
  })

  it('keys by (host, app_id) — different hosts isolate', async () => {
    const c = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    await c.set('h1', 'app-1', metaInfoOnly())
    expect(c.get('h2', 'app-1')).toBeUndefined()
    expect(c.get('h1', 'app-1')).toBeDefined()
  })

  it('delete removes entry from disk', async () => {
    const c1 = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    await c1.set('h', 'app-1', metaInfoOnly())
    await c1.delete('h', 'app-1')

    const c2 = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    expect(c2.get('h', 'app-1')).toBeUndefined()
  })

  it('writes file with 0600 permission', async () => {
    const c = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    await c.set('h', 'app-1', metaInfoOnly())
    const { stat } = await import('node:fs/promises')
    const s = await stat(appInfoPath(dir))
    if (platform() !== 'win32')
      expect(s.mode & 0o777).toBe(0o600)
  })

  it('missing cache file is not an error', async () => {
    const c = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    expect(c.get('h', 'app-1')).toBeUndefined()
  })

  it('corrupt cache file is treated as empty', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(appInfoPath(dir), ': : not valid yaml', 'utf8')
    const c = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
    expect(c.get('h', 'app-1')).toBeUndefined()
  })

  it('updates same key in place (no growth)', async () => {
    const c = await loadAppInfoCache({ store: new YamlStore(cachePath(dir, CACHE_APP_INFO)) })
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
