import type { Key, Store } from './store'
import { describe, expect, it, vi } from 'vitest'
import { getTokenStore } from './manager'

function memStore(label: string): Store & { _label: string } {
  const map = new Map<string, unknown>()
  return {
    _label: label,
    async get<T>(key: Key<T>): Promise<T> {
      return (map.get(key.key) as T | undefined) ?? key.default
    },
    async set<T>(key: Key<T>, value: T): Promise<void> {
      map.set(key.key, value)
    },
    async unset<T>(key: Key<T>): Promise<void> {
      map.delete(key.key)
    },
  }
}

describe('getTokenStore', () => {
  it('returns keychain store when probe succeeds', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    const result = await getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('keychain')
    expect(result.store).toBe(k)
  })

  it('falls back to file when keyring set throws', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.set = vi.fn(
      () => {
        throw new Error('locked')
      },
    ) as Store['set']
    const result = await getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when probe round-trip mismatches', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.get = vi.fn(async () => 'something-else') as Store['get']
    const result = await getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when keyring constructor throws', async () => {
    const f = memStore('file')
    const result = await getTokenStore({
      factory: {
        keyring: () => { throw new Error('no backend') },
        file: () => f,
      },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('cleans up probe entry after successful probe', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    await getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(await k.get({ key: '__difyctl_probe__', default: '' })).toBe('')
  })
})
