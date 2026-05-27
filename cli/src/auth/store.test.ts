import type { TokenStore } from './store.js'
import { describe, expect, it, vi } from 'vitest'
import { selectStore } from './store.js'

function memBackend(label: string): TokenStore & { _label: string } {
  const map = new Map<string, string>()
  const k = (h: string, a: string) => `${h}::${a}`
  return {
    _label: label,
    async put(h, a, t) { map.set(k(h, a), t) },
    async get(h, a) { return map.get(k(h, a)) },
    async delete(h, a) { map.delete(k(h, a)) },
    async list() { return [] },
  }
}

describe('selectStore', () => {
  it('returns keychain when probe succeeds', async () => {
    const k = memBackend('keyring')
    const f = memBackend('file')
    const result = await selectStore({
      configDir: '/tmp/x',
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('keychain')
    expect(result.store).toBe(k)
  })

  it('falls back to file when keyring put throws', async () => {
    const k = memBackend('keyring')
    const f = memBackend('file')
    k.put = vi.fn().mockRejectedValue(new Error('locked'))
    const result = await selectStore({
      configDir: '/tmp/x',
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when probe round-trip mismatches', async () => {
    const k = memBackend('keyring')
    const f = memBackend('file')
    k.get = vi.fn().mockResolvedValue('something-else')
    const result = await selectStore({
      configDir: '/tmp/x',
      factory: { keyring: () => k, file: () => f },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('falls back to file when keyring constructor throws', async () => {
    const f = memBackend('file')
    const result = await selectStore({
      configDir: '/tmp/x',
      factory: {
        keyring: () => { throw new Error('no backend') },
        file: () => f,
      },
    })
    expect(result.mode).toBe('file')
    expect(result.store).toBe(f)
  })

  it('cleans up probe entry after successful probe', async () => {
    const k = memBackend('keyring')
    const f = memBackend('file')
    await selectStore({
      configDir: '/tmp/x',
      factory: { keyring: () => k, file: () => f },
    })
    expect(await k.get('__difyctl_probe__', '__probe__')).toBeUndefined()
  })
})
