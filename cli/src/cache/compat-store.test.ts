import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_COMPAT, getCache } from '@/store/manager'
import { loadCompatStore } from './compat-store'

const HOST = 'https://cloud.dify.ai'
const NOW = new Date('2026-05-20T12:00:00.000Z')

describe('compat-store', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-compat-'))
    prev = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
  })
  afterEach(async () => {
    if (prev === undefined)
      delete process.env[ENV_CACHE_DIR]
    else
      process.env[ENV_CACHE_DIR] = prev
    await rm(dir, { recursive: true, force: true })
  })

  const store = (now: Date = NOW) => loadCompatStore({ store: getCache(CACHE_COMPAT), now: () => now })

  it('is not fresh before anything is marked', async () => {
    expect((await store()).isFreshCompatible(HOST)).toBe(false)
  })

  it('is fresh right after markCompatible, and persists across loads', async () => {
    await (await store()).markCompatible(HOST)
    expect((await store()).isFreshCompatible(HOST)).toBe(true)
  })

  it('stays fresh within the 1h TTL', async () => {
    const past = new Date(NOW.getTime() - 30 * 60 * 1000)
    await (await store(past)).markCompatible(HOST)
    expect((await store(NOW)).isFreshCompatible(HOST)).toBe(true)
  })

  it('expires after the 1h TTL', async () => {
    const past = new Date(NOW.getTime() - 61 * 60 * 1000)
    await (await store(past)).markCompatible(HOST)
    expect((await store(NOW)).isFreshCompatible(HOST)).toBe(false)
  })

  it('tracks hosts independently', async () => {
    const s = await store()
    await s.markCompatible(HOST)
    expect(s.isFreshCompatible('https://other.dify.ai')).toBe(false)
  })
})
