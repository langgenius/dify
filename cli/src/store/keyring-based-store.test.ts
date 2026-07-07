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

  async setPassword(value: string): Promise<void> {
    setPassword(this.key, value)
    passwords.set(this.key, value)
  }

  async getPassword(): Promise<string | undefined> {
    getPassword(this.key)
    return passwords.get(this.key) ?? undefined
  }

  async deletePassword(): Promise<boolean> {
    deletePassword(this.key)
    if (!passwords.has(this.key))
      return false
    passwords.delete(this.key)
    return true
  }
}

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: FakeEntry,
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
  it('returns default when entry missing', async () => {
    const s = new KeyringBasedStore(SERVICE)
    expect(await s.get({ key: 'k', default: 'fallback' })).toBe('fallback')
  })

  it('round-trips strings via JSON encoding', async () => {
    const s = new KeyringBasedStore(SERVICE)
    await s.set({ key: 'k', default: '' }, 'tok-abc')
    expect(await s.get({ key: 'k', default: '' })).toBe('tok-abc')
  })

  it('isolates entries by key', async () => {
    const s = new KeyringBasedStore(SERVICE)
    await s.set({ key: 'a', default: '' }, 'A')
    await s.set({ key: 'b', default: '' }, 'B')
    expect(await s.get({ key: 'a', default: '' })).toBe('A')
    expect(await s.get({ key: 'b', default: '' })).toBe('B')
  })

  it('unset removes the entry', async () => {
    const s = new KeyringBasedStore(SERVICE)
    await s.set({ key: 'k', default: '' }, 'v')
    await s.unset({ key: 'k', default: '' })
    expect(await s.get({ key: 'k', default: '' })).toBe('')
  })

  it('unset is a no-op when entry missing', async () => {
    const s = new KeyringBasedStore(SERVICE)
    await expect(s.unset({ key: 'gone', default: '' })).resolves.not.toThrow()
  })

  it('swallows getPassword exceptions and returns default', async () => {
    const s = new KeyringBasedStore(SERVICE)
    getPassword.mockImplementationOnce(
      () => {
        throw new Error('NoEntry')
      },
    )
    expect(await s.get({ key: 'k', default: 'd' })).toBe('d')
  })

  it('swallows unset exceptions', async () => {
    const s = new KeyringBasedStore(SERVICE)
    deletePassword.mockImplementationOnce(
      () => {
        throw new Error('NoEntry')
      },
    )
    await expect(s.unset({ key: 'k', default: '' })).resolves.not.toThrow()
  })

  it('lets set propagate exceptions (caller decides fallback)', async () => {
    const s = new KeyringBasedStore(SERVICE)
    setPassword.mockImplementationOnce(
      () => {
        throw new Error('keyring locked')
      },
    )
    await expect(s.set({ key: 'k', default: '' }, 'v')).rejects.toThrow(/keyring locked/)
  })
})
