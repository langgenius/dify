import type { CompatSnapshot, CompatSnapshotStore } from '../cache/compat-snapshot.js'
import type { ServerVersionResponse } from '../types/data-contracts.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCompatSnapshotStore } from '../cache/compat-snapshot.js'
import { maybeNudgeCompat } from './nudge.js'

const HOST = 'https://cloud.dify.ai'
const NOW = new Date('2026-05-20T12:00:00.000Z')
const fixedNow = () => NOW

function freshSnapshot(overrides: Partial<CompatSnapshot> = {}): CompatSnapshot {
  return {
    host: HOST,
    fetchedAt: '2026-05-20T11:00:00.000Z', // 1h before NOW
    server: { version: '1.6.4', edition: 'CLOUD' },
    compat: {
      status: 'compatible',
      detail: 'in range',
      minDify: '1.6.0',
      maxDify: '1.7.0',
    },
    ...overrides,
  }
}

type Probe = (host: string) => Promise<ServerVersionResponse>

function emitterSpy() {
  const lines: string[] = []
  return {
    emit: (line: string) => lines.push(line),
    lines,
  }
}

async function buildStore() {
  const dir = await mkdtemp(join(tmpdir(), 'difyctl-nudge-'))
  const store = await loadCompatSnapshotStore({ configDir: dir, now: fixedNow })
  return { dir, store }
}

describe('maybeNudgeCompat', () => {
  let dir: string
  let store: CompatSnapshotStore

  beforeEach(async () => {
    ;({ dir, store } = await buildStore())
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('cold cache + probe ok: persists snapshot, does NOT banner (first-time quiet)', async () => {
    const probe: Probe = async () => ({ version: '99.0.0', edition: 'SELF_HOSTED' }) // unsupported
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
    expect(store.get(HOST)).toBeDefined()
    expect(store.get(HOST)!.compat.status).toBe('unsupported')
  })

  it('cold cache + probe rejects: no persist, no banner, no throw', async () => {
    const probe: Probe = async () => {
      throw new Error('timeout')
    }
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
    expect(store.get(HOST)).toBeUndefined()
  })

  it('warm fresh cache + compatible: no probe, no banner', async () => {
    await store.set(freshSnapshot({ compat: { status: 'compatible', detail: '', minDify: '1.6.0', maxDify: '1.7.0' } }))
    const probe = vi.fn() as unknown as Probe
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(probe).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('warm fresh unsupported + never warned + TTY + text: banner fires + markWarned', async () => {
    await store.set(freshSnapshot({ compat: { status: 'unsupported', detail: 'oops', minDify: '1.6.0', maxDify: '1.7.0' } }))
    const probe = vi.fn() as unknown as Probe
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(probe).not.toHaveBeenCalled()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('warning:')
    expect(lines[0]).toContain('may be incompatible')
    expect(store.get(HOST)!.lastWarnedAt).toBe(NOW.toISOString())
  })

  it('warm fresh unsupported + format=json: no banner', async () => {
    await store.set(freshSnapshot({ compat: { status: 'unsupported', detail: 'oops', minDify: '1.6.0', maxDify: '1.7.0' } }))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe: vi.fn() as unknown as Probe,
      emit,
      isTty: true,
      format: 'json',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
  })

  it.each(['yaml', 'name'])('warm fresh unsupported + format=%s: no banner', async (format) => {
    await store.set(freshSnapshot({ compat: { status: 'unsupported', detail: 'oops', minDify: '1.6.0', maxDify: '1.7.0' } }))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe: vi.fn() as unknown as Probe,
      emit,
      isTty: true,
      format,
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
  })

  it('warm fresh unsupported + !TTY: no banner', async () => {
    await store.set(freshSnapshot({ compat: { status: 'unsupported', detail: 'oops', minDify: '1.6.0', maxDify: '1.7.0' } }))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe: vi.fn() as unknown as Probe,
      emit,
      isTty: false,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
  })

  it('warm fresh unsupported + lastWarnedAt 2h ago: no banner (silence window)', async () => {
    await store.set(freshSnapshot({
      compat: { status: 'unsupported', detail: 'oops', minDify: '1.6.0', maxDify: '1.7.0' },
      lastWarnedAt: '2026-05-20T10:00:00.000Z', // 2h before NOW
    }))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe: vi.fn() as unknown as Probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
  })

  it('warm fresh unsupported + lastWarnedAt 25h ago: banner fires again', async () => {
    await store.set(freshSnapshot({
      compat: { status: 'unsupported', detail: 'oops', minDify: '1.6.0', maxDify: '1.7.0' },
      lastWarnedAt: '2026-05-19T10:00:00.000Z', // 26h before NOW
    }))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe: vi.fn() as unknown as Probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(1)
    expect(store.get(HOST)!.lastWarnedAt).toBe(NOW.toISOString())
  })

  it('stale cache + probe returns now-compatible: refresh, no banner', async () => {
    await store.set(freshSnapshot({
      fetchedAt: '2026-05-19T10:00:00.000Z', // 26h before NOW
      compat: { status: 'unsupported', detail: 'old', minDify: '1.6.0', maxDify: '1.7.0' },
    }))
    const probe: Probe = async () => ({ version: '1.6.4', edition: 'CLOUD' })
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
    expect(store.get(HOST)!.compat.status).toBe('compatible')
    expect(store.get(HOST)!.fetchedAt).toBe(NOW.toISOString())
  })

  it('stale cache + probe rejects: keep prior snapshot, may still banner from stale data', async () => {
    await store.set(freshSnapshot({
      fetchedAt: '2026-05-19T10:00:00.000Z', // stale
      compat: { status: 'unsupported', detail: 'pre-existing', minDify: '1.6.0', maxDify: '1.7.0' },
    }))
    const probe: Probe = async () => {
      throw new Error('net down')
    }
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(1)
    // fetchedAt is NOT updated because probe failed
    expect(store.get(HOST)!.fetchedAt).toBe('2026-05-19T10:00:00.000Z')
  })

  it('warm fresh unknown: no banner (unknown is too noisy to alert on)', async () => {
    await store.set(freshSnapshot({
      compat: { status: 'unknown', detail: 'who knows', minDify: '1.6.0', maxDify: '1.7.0' },
    }))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, {
      store,
      probe: vi.fn() as unknown as Probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })

    expect(lines).toHaveLength(0)
  })

  it('never throws even if every dependency explodes', async () => {
    const explodingStore: CompatSnapshotStore = {
      get: () => { throw new Error('get boom') },
      set: async () => { throw new Error('set boom') },
      isFresh: () => { throw new Error('fresh boom') },
      canWarn: () => { throw new Error('warn boom') },
      markWarned: async () => { throw new Error('mark boom') },
    }
    const probe: Probe = async () => {
      throw new Error('probe boom')
    }
    const emit = () => {
      throw new Error('emit boom')
    }

    await expect(maybeNudgeCompat(HOST, {
      store: explodingStore,
      probe,
      emit,
      isTty: true,
      format: '',
      now: fixedNow,
    })).resolves.toBeUndefined()
  })
})
