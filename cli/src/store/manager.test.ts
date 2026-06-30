import type { TokenStore } from './token-store'
import { describe, expect, it, vi } from 'vitest'
import { detectTokenStore, getTokenStore } from './manager'

function memStore(label: string): TokenStore & { _label: string } {
  const map = new Map<string, string>()
  const k = (h: string, e: string): string => `${h} ${e}`
  return {
    _label: label,
    async read(host: string, email: string): Promise<string> {
      return map.get(k(host, email)) ?? ''
    },
    async write(host: string, email: string, bearer: string): Promise<void> {
      map.set(k(host, email), bearer)
    },
    async remove(host: string, email: string): Promise<void> {
      map.delete(k(host, email))
    },
  }
}

describe('detectTokenStore', () => {
  it('returns keychain store when probe succeeds', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    const result = await detectTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('keychain')
    expect(result.store).toBe(k)
  })

  it('falls back to file when keyring set throws', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.write = vi.fn(() => {
      throw new Error('locked')
    }) as TokenStore['write']
    const result = await detectTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when probe round-trip mismatches', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.read = vi.fn(async () => 'something-else') as TokenStore['read']
    const result = await detectTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when keyring constructor throws', async () => {
    const f = memStore('file')
    const result = await detectTokenStore({
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
    await detectTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(await k.read('__difyctl_probe__', '__difyctl_probe__')).toBe('')
  })

  it('removes the probe entry even when the probe read throws', async () => {
    const k = memStore('keyring')
    const f = memStore('file')
    const removeSpy = vi.spyOn(k, 'remove')
    k.read = vi.fn(() => {
      throw new Error('read boom')
    }) as TokenStore['read']
    const result = await detectTokenStore({
      factory: { keyring: () => k, file: () => f },
    })
    expect(removeSpy).toHaveBeenCalledWith('__difyctl_probe__', '__difyctl_probe__')
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })
})

describe('getTokenStore', () => {
  it('constructs the keychain backend without probing when mode is keychain', () => {
    const k = memStore('keyring')
    const f = memStore('file')
    k.write = vi.fn(() => {
      throw new Error('probe must never run on the read path')
    }) as TokenStore['write']
    const store = getTokenStore('keychain', {
      factory: { keyring: () => k, file: () => f },
    })
    expect(store).toBe(k)
  })

  it('constructs the file backend when mode is file, never touching the keyring', () => {
    const keyringFactory = vi.fn(() => memStore('keyring'))
    const f = memStore('file')
    const store = getTokenStore('file', {
      factory: { keyring: keyringFactory, file: () => f },
    })
    expect(store).toBe(f)
    expect(keyringFactory).not.toHaveBeenCalled()
  })
})
