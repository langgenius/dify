import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { NudgeStore } from '@/cache/nudge-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadNudgeStore } from '@/cache/nudge-store'
import { ENV_CACHE_DIR } from '@/store/dir'
import { CACHE_NUDGE, getCache } from '@/store/manager'
import { maybeNudgeCompat } from './nudge'

const HOST = 'https://cloud.dify.ai'
const NOW = new Date('2026-05-20T12:00:00.000Z')
const fixedNow = () => NOW

type Probe = (host: string) => Promise<ServerVersionResponse>

const UNSUPPORTED: ServerVersionResponse = { version: '99.0.0', edition: 'SELF_HOSTED' }
const COMPATIBLE: ServerVersionResponse = { version: '1.6.4', edition: 'CLOUD' }

function emitterSpy() {
  const lines: string[] = []
  return { emit: (line: string) => lines.push(line), lines }
}

function baseDeps(overrides: Partial<{
  store: NudgeStore
  probe: Probe
  emit: (line: string) => void
  isTty: boolean
  format: string
  clientVersion: string
}> & { store: NudgeStore } & { probe: Probe } & { emit: (line: string) => void }) {
  return {
    isTty: true,
    format: '',
    clientVersion: '0.1.0',
    now: fixedNow,
    ...overrides,
  }
}

describe('maybeNudgeCompat', () => {
  let dir: string
  let store: NudgeStore

  let prevCacheDir: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-nudge-'))
    prevCacheDir = process.env[ENV_CACHE_DIR]
    process.env[ENV_CACHE_DIR] = dir
    store = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: fixedNow })
  })
  afterEach(async () => {
    if (prevCacheDir === undefined)
      delete process.env[ENV_CACHE_DIR]
    else
      process.env[ENV_CACHE_DIR] = prevCacheDir
    await rm(dir, { recursive: true, force: true })
  })

  it('probes + warns when server is unsupported (TTY, text format, never warned)', async () => {
    const probe = vi.fn(async () => UNSUPPORTED)
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit }))

    expect(probe).toHaveBeenCalledOnce()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('warning:')
    expect(lines[0]).toContain('99.0.0')
    expect(store.canWarn(HOST)).toBe(false)
  })

  it('does not probe nor warn when throttled (lastWarnedAt within 24h)', async () => {
    await store.markWarned(HOST)
    const probe = vi.fn(async () => UNSUPPORTED)
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit }))

    expect(probe).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('warns again after the silence window has elapsed', async () => {
    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60 * 1000)
    const tStore = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: () => yesterday })
    await tStore.markWarned(HOST)
    const probe = vi.fn(async () => UNSUPPORTED)
    const { emit, lines } = emitterSpy()

    const freshStore = await loadNudgeStore({ store: getCache(CACHE_NUDGE), now: fixedNow })
    await maybeNudgeCompat(HOST, baseDeps({ store: freshStore, probe, emit }))

    expect(probe).toHaveBeenCalledOnce()
    expect(lines).toHaveLength(1)
  })

  it('does nothing when probe rejects (no warn, no markWarned)', async () => {
    const probe: Probe = async () => {
      throw new Error('net down')
    }
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit }))

    expect(lines).toHaveLength(0)
    expect(store.canWarn(HOST)).toBe(true)
  })

  it('does not warn when server is compatible', async () => {
    const probe = vi.fn(async () => COMPATIBLE)
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit }))

    expect(probe).toHaveBeenCalledOnce()
    expect(lines).toHaveLength(0)
    expect(store.canWarn(HOST)).toBe(true)
  })

  it('does not warn when server version yields unknown verdict', async () => {
    const probe = vi.fn(async () => ({ version: '', edition: 'SELF_HOSTED' } as ServerVersionResponse))
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit }))

    expect(lines).toHaveLength(0)
    expect(store.canWarn(HOST)).toBe(true)
  })

  it.each(['json', 'yaml', 'name'])('skips probe + banner when format=%s', async (format) => {
    const probe = vi.fn(async () => UNSUPPORTED)
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit, format }))

    expect(probe).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('skips probe + banner when stdout is not a TTY', async () => {
    const probe = vi.fn(async () => UNSUPPORTED)
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit, isTty: false }))

    expect(probe).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('formats the banner with the injected clientVersion (not a global)', async () => {
    const probe = vi.fn(async () => UNSUPPORTED)
    const { emit, lines } = emitterSpy()

    await maybeNudgeCompat(HOST, baseDeps({ store, probe, emit, clientVersion: '9.9.9-test' }))

    expect(lines[0]).toContain('difyctl 9.9.9-test')
  })

  it('never throws even when every dependency explodes', async () => {
    const explodingStore: NudgeStore = {
      canWarn: () => { throw new Error('canWarn boom') },
      markWarned: async () => { throw new Error('markWarned boom') },
    }
    const probe: Probe = async () => {
      throw new Error('probe boom')
    }
    const emit = () => {
      throw new Error('emit boom')
    }

    await expect(maybeNudgeCompat(HOST, baseDeps({
      store: explodingStore,
      probe,
      emit,
    }))).resolves.toBeUndefined()
  })
})
