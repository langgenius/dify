import { beforeEach, describe, expect, it, vi } from 'vitest'

const passwords = new Map<string, string>()
const setPassword = vi.fn()
const getPassword = vi.fn()
const deletePassword = vi.fn()

class FakeEntry {
  private readonly key: string
  constructor(service: string, username: string) {
    this.key = `${service}::${username}`
  }

  setPassword(value: string): void {
    setPassword(this.key, value)
    passwords.set(this.key, value)
  }

  getPassword(): string | null {
    getPassword(this.key)
    return passwords.get(this.key) ?? null
  }

  deletePassword(): boolean {
    deletePassword(this.key)
    if (!passwords.has(this.key))
      return false
    passwords.delete(this.key)
    return true
  }
}

vi.mock('@napi-rs/keyring', () => ({
  Entry: FakeEntry,
}))

const { KeyringBasedStore } = await import('./store')

const SERVICE = 'difyctl-test'

beforeEach(() => {
  passwords.clear()
  setPassword.mockClear()
  getPassword.mockClear()
  deletePassword.mockClear()
})

describe('KeyringBasedStore', () => {
  it('returns default when entry missing', () => {
    const s = new KeyringBasedStore(SERVICE)
    expect(s.get({ key: 'k', default: 'fallback' })).toBe('fallback')
  })

  it('round-trips strings via JSON encoding', () => {
    const s = new KeyringBasedStore(SERVICE)
    s.set({ key: 'k', default: '' }, 'tok-abc')
    expect(s.get({ key: 'k', default: '' })).toBe('tok-abc')
  })

  it('isolates entries by key', () => {
    const s = new KeyringBasedStore(SERVICE)
    s.set({ key: 'a', default: '' }, 'A')
    s.set({ key: 'b', default: '' }, 'B')
    expect(s.get({ key: 'a', default: '' })).toBe('A')
    expect(s.get({ key: 'b', default: '' })).toBe('B')
  })

  it('unset removes the entry', () => {
    const s = new KeyringBasedStore(SERVICE)
    s.set({ key: 'k', default: '' }, 'v')
    s.unset({ key: 'k', default: '' })
    expect(s.get({ key: 'k', default: '' })).toBe('')
  })

  it('unset is a no-op when entry missing', () => {
    const s = new KeyringBasedStore(SERVICE)
    expect(() => s.unset({ key: 'gone', default: '' })).not.toThrow()
  })

  it('swallows getPassword exceptions and returns default', () => {
    const s = new KeyringBasedStore(SERVICE)
    getPassword.mockImplementationOnce(
      () => {
        throw new Error('NoEntry')
      },
    )
    expect(s.get({ key: 'k', default: 'd' })).toBe('d')
  })

  it('swallows unset exceptions', () => {
    const s = new KeyringBasedStore(SERVICE)
    deletePassword.mockImplementationOnce(
      () => {
        throw new Error('NoEntry')
      },
    )
    expect(() => s.unset({ key: 'k', default: '' })).not.toThrow()
  })

  it('lets set propagate exceptions (caller decides fallback)', () => {
    const s = new KeyringBasedStore(SERVICE)
    setPassword.mockImplementationOnce(
      () => {
        throw new Error('keyring locked')
      },
    )
    expect(() => s.set({ key: 'k', default: '' }, 'v')).toThrow(/keyring locked/)
  })
})
