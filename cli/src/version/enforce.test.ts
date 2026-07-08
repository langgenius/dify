import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { CompatStore } from '@/cache/compat-store'
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@/errors/codes'
import { enforceDifyVersion } from './enforce'

// Injected build range in tests is __DIFYCTL_MIN_DIFY__=1.6.0 / MAX=1.7.0 (test/setup.ts):
// 1.5.0 → too_old, 1.6.4 → compatible, 99.0.0 → too_new, '' → unknown.
const HOST = 'https://cloud.dify.ai'

function fakeStore(fresh = false): CompatStore & { readonly marked: string[] } {
  const marked: string[] = []
  return {
    marked,
    isFreshCompatible: () => fresh,
    markCompatible: async (host) => {
      marked.push(host)
    },
  }
}

const server = (version: string): ServerVersionResponse => ({ version, edition: 'SELF_HOSTED' })

describe('enforceDifyVersion', () => {
  it('throws version_skew (exit 6) when the server is too old, and never caches it', async () => {
    const store = fakeStore()
    const probe = vi.fn(async () => server('1.5.0'))

    await expect(enforceDifyVersion(HOST, { store, probe })).rejects.toMatchObject({ code: ErrorCode.VersionSkew })
    expect(store.marked).toHaveLength(0)
  })

  it('passes and caches when the server is compatible', async () => {
    const store = fakeStore()
    const probe = vi.fn(async () => server('1.6.4'))

    const res = await enforceDifyVersion(HOST, { store, probe })

    expect(res?.version).toBe('1.6.4')
    expect(store.marked).toEqual([HOST])
  })

  it('passes (soft, no throw) and caches when the server is too new', async () => {
    const store = fakeStore()
    const probe = vi.fn(async () => server('99.0.0'))

    await expect(enforceDifyVersion(HOST, { store, probe })).resolves.toBeDefined()
    expect(store.marked).toEqual([HOST])
  })

  it('skips the probe entirely when the host is fresh-compatible', async () => {
    const store = fakeStore(true)
    const probe = vi.fn(async () => server('1.5.0')) // would throw if it ran

    await expect(enforceDifyVersion(HOST, { store, probe })).resolves.toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })

  it('re-probes despite a fresh cache when forceFresh is set', async () => {
    const store = fakeStore(true)
    const probe = vi.fn(async () => server('1.5.0'))

    await expect(enforceDifyVersion(HOST, { store, probe, forceFresh: true }))
      .rejects
      .toMatchObject({ code: ErrorCode.VersionSkew })
    expect(probe).toHaveBeenCalledOnce()
  })

  it('fails open (never blocks, never caches) when the probe errors', async () => {
    const store = fakeStore()
    const probe = vi.fn(async () => {
      throw new Error('net down')
    })

    await expect(enforceDifyVersion(HOST, { store, probe })).resolves.toBeUndefined()
    expect(store.marked).toHaveLength(0)
  })

  it('does not block or cache on an unknown server version', async () => {
    const store = fakeStore()
    const probe = vi.fn(async () => server(''))

    await expect(enforceDifyVersion(HOST, { store, probe })).resolves.toBeDefined()
    expect(store.marked).toHaveLength(0)
  })
})
