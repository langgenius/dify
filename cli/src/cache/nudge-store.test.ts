import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_NUDGE, cachePath, getCache } from '@/store/manager'
import { loadNudgeStore, WARN_INTERVAL_MS } from './nudge-store'

function nudgeStorePath(dir: string): string {
  return cachePath(dir, CACHE_NUDGE)
}

const HOST = 'https://cloud.dify.ai'

describe('NudgeStore', () => {
  let dir: string
  let prevCacheDir: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-nudge-'))
    prevCacheDir = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
  })
  afterEach(async () => {
    if (prevCacheDir === undefined) delete process.env[ENV_CACHE_DIR]
    else process.env[ENV_CACHE_DIR] = prevCacheDir
    await rm(dir, { recursive: true, force: true })
  })

  it('canWarn=true when no prior record exists', async () => {
    const store = await loadNudgeStore({ store: getCache(CACHE_NUDGE) })
    expect(store.canWarn(HOST)).toBe(true)
  })

  it('canWarn=false within the silence window, true past it', async () => {
    const t0 = new Date('2026-05-19T12:00:00.000Z')
    const store = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t0 })
    await store.markWarned(HOST)
    expect(store.canWarn(HOST, new Date('2026-05-19T18:00:00.000Z'))).toBe(false)
    expect(store.canWarn(HOST, new Date('2026-05-20T12:00:00.000Z'))).toBe(true)
  })

  it('canWarn clamps negative elapsed under clock skew (treats as still in window)', async () => {
    const t0 = new Date('2026-05-19T12:00:00.000Z')
    const store = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t0 })
    await store.markWarned(HOST)
    const pastClock = new Date('2026-05-19T11:00:00.000Z') // clock moved backwards 1h
    expect(store.canWarn(HOST, pastClock)).toBe(false)
  })

  it('markWarned persists across store reloads', async () => {
    const t0 = new Date('2026-05-19T12:00:00.000Z')
    const s1 = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t0 })
    await s1.markWarned(HOST)
    const s2 = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t0 })
    expect(s2.canWarn(HOST)).toBe(false)
  })

  it('treats a corrupt cache file as empty', async () => {
    const path = nudgeStorePath(dir)
    await writeCacheFile(path, '{ not valid json')
    const store = await loadNudgeStore({ store: getCache(CACHE_NUDGE) })
    expect(store.canWarn(HOST)).toBe(true)
  })

  it('writes ISO timestamps under warned/<host> on disk', async () => {
    const t = new Date('2026-05-19T12:00:00.000Z')
    const store = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t })
    await store.markWarned(HOST)
    const raw = await readFile(nudgeStorePath(dir), 'utf8')
    const parsed = load(raw) as Record<string, unknown>
    expect((parsed.warned as Record<string, string>)[HOST]).toBe(t.toISOString())
  })

  it('concurrent writers across different hosts: both stamps survive (merge-on-write)', async () => {
    // Two stores independently loaded (simulating two CLI processes), each
    // warns about a different host. Without merge-on-write the second writer
    // would clobber the first.
    const t = new Date('2026-05-19T12:00:00.000Z')
    const a = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t })
    const b = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t })
    await a.markWarned('https://a.example')
    await b.markWarned('https://b.example')
    const reread = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => t })
    expect(reread.canWarn('https://a.example')).toBe(false)
    expect(reread.canWarn('https://b.example')).toBe(false)
  })

  it('exposes WARN_INTERVAL_MS as 24h', () => {
    expect(WARN_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
  })
})

async function writeCacheFile(path: string, body: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)
}
