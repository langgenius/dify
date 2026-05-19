import type { CompatSnapshot } from './compat-snapshot.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compatSnapshotPath, loadCompatSnapshotStore } from './compat-snapshot.js'

const HOST = 'https://cloud.dify.ai'

function fakeSnapshot(overrides: Partial<CompatSnapshot> = {}): CompatSnapshot {
  return {
    host: HOST,
    fetchedAt: '2026-05-19T12:00:00.000Z',
    server: { version: '1.6.4', edition: 'CLOUD' },
    compat: {
      status: 'compatible',
      detail: 'server 1.6.4 in [1.6.0, 1.7.0]',
      minDify: '1.6.0',
      maxDify: '1.7.0',
    },
    ...overrides,
  }
}

describe('CompatSnapshotStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-compat-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns undefined when no cache file exists yet', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    expect(store.get(HOST)).toBeUndefined()
  })

  it('treats a corrupt cache file as empty (no throw)', async () => {
    const path = compatSnapshotPath(dir)
    await writeCacheFile(path, '{ not valid json')
    const store = await loadCompatSnapshotStore({ configDir: dir })
    expect(store.get(HOST)).toBeUndefined()
  })

  it('ignores cache file with mismatched schema', async () => {
    const path = compatSnapshotPath(dir)
    await writeCacheFile(path, JSON.stringify({ schema: 99, by_host: {} }))
    const store = await loadCompatSnapshotStore({ configDir: dir })
    expect(store.get(HOST)).toBeUndefined()
  })

  it('persists and reads back a snapshot through a fresh store instance', async () => {
    const snap = fakeSnapshot()
    const s1 = await loadCompatSnapshotStore({ configDir: dir })
    await s1.set(snap)
    const s2 = await loadCompatSnapshotStore({ configDir: dir })
    expect(s2.get(HOST)).toEqual(snap)
  })

  it('writes file with snake_case keys on disk', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    await store.set(fakeSnapshot())
    const raw = await readFile(compatSnapshotPath(dir), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.schema).toBe(1)
    expect(parsed.by_host).toBeDefined()
    const entry = (parsed.by_host as Record<string, Record<string, unknown>>)[HOST]
    expect(entry).toHaveProperty('fetched_at')
    expect(entry).toHaveProperty('compat')
    expect((entry.compat as Record<string, unknown>).min_dify).toBe('1.6.0')
    expect((entry.compat as Record<string, unknown>).max_dify).toBe('1.7.0')
  })

  it('isFresh: true when within TTL, false when past TTL', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    const snap = fakeSnapshot({ fetchedAt: '2026-05-19T12:00:00.000Z' })
    expect(store.isFresh(snap, new Date('2026-05-19T13:00:00.000Z'))).toBe(true)
    expect(store.isFresh(snap, new Date('2026-05-20T13:00:00.000Z'))).toBe(false)
    // boundary: exactly 24h is not fresh
    expect(store.isFresh(snap, new Date('2026-05-20T12:00:00.000Z'))).toBe(false)
  })

  it('canWarn: true when no prior warn, false within silence window, true after', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    const cold = fakeSnapshot({ lastWarnedAt: undefined })
    expect(store.canWarn(cold)).toBe(true)
    const warmed = fakeSnapshot({ lastWarnedAt: '2026-05-19T12:00:00.000Z' })
    expect(store.canWarn(warmed, new Date('2026-05-19T18:00:00.000Z'))).toBe(false)
    expect(store.canWarn(warmed, new Date('2026-05-20T12:00:00.000Z'))).toBe(true)
  })

  it('markWarned only updates lastWarnedAt, leaves other fields intact', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    await store.set(fakeSnapshot({ lastWarnedAt: undefined }))
    await store.markWarned(HOST, new Date('2026-05-19T15:30:00.000Z'))
    const after = store.get(HOST)!
    expect(after.lastWarnedAt).toBe('2026-05-19T15:30:00.000Z')
    expect(after.fetchedAt).toBe('2026-05-19T12:00:00.000Z')
    expect(after.compat.status).toBe('compatible')
  })

  it('markWarned on absent host is a no-op (no throw)', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    await expect(store.markWarned('https://nowhere')).resolves.toBeUndefined()
  })

  it('multiple hosts cohabit the cache file independently', async () => {
    const store = await loadCompatSnapshotStore({ configDir: dir })
    await store.set(fakeSnapshot({ host: 'https://a' }))
    await store.set(fakeSnapshot({ host: 'https://b', server: { version: '1.7.0', edition: 'SELF_HOSTED' } }))
    const reread = await loadCompatSnapshotStore({ configDir: dir })
    expect(reread.get('https://a')?.server.version).toBe('1.6.4')
    expect(reread.get('https://b')?.server.version).toBe('1.7.0')
  })
})

async function writeCacheFile(path: string, body: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)
}
