import type { Key, Store } from './store.js'
import { describe, expect, it, vi } from 'vitest'
import { getTokenStore } from './manager.js'

function memStore(label: string): Store & { _label: string } {
  const map = new Map<string, unknown>()
  return {
    _label: label,
    get<T>(key: Key<T>): T {
      return (map.get(key.key) as T | undefined) ?? key.default
    },
    set<T>(key: Key<T>, value: T): void {
      map.set(key.key, value)
    },
    unset<T>(key: Key<T>): void {
      map.delete(key.key)
    },
  }
}

describe('getTokenStore', () => {
  it('returns keychain store when probe succeeds', () => {
    const k = memStore('keyring')
    const f = memStore('file')
    const result = getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('keychain')
    expect(result.store).toBe(k)
  })

  it('falls back to file when keyring set throws', () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.set = vi.fn(
      () => {
        throw new Error('locked')
      },
    )
    const result = getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when probe round-trip mismatches', () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.get = vi.fn(() => 'something-else')
    const result = getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when keyring constructor throws', () => {
    const f = memStore('file')
    const result = getTokenStore({
      factory: {
        keyring: () => { throw new Error('no backend') },
        file: () => f,
      },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('cleans up probe entry after successful probe', () => {
    const k = memStore('keyring')
    const f = memStore('file')
    getTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(k.get({ key: '__difyctl_probe__', default: '' })).toBe('')
  })
})
