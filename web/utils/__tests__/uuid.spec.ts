import { describe, expect, it, vi } from 'vitest'
import { generateUUID } from '../uuid'

describe('generateUUID', () => {
  it('returns a valid uuid-format string', () => {
    const id = generateUUID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('returns unique values across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUUID()))
    expect(ids.size).toBe(100)
  })

  it('falls back when crypto.randomUUID is unavailable', async () => {
    const original = globalThis.crypto
    // Simulate an insecure context where randomUUID is missing.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: original.getRandomValues.bind(original) },
    })
    try {
      vi.resetModules()
      const { generateUUID: fallbackUUID } = await import('../uuid')
      const id = fallbackUUID()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original })
      vi.resetModules()
    }
  })
})
