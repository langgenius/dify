import { beforeEach, describe, expect, it, vi } from 'vitest'

const passwords = new Map<string, string>()
const setPassword = vi.fn()
const getPassword = vi.fn()
const deletePassword = vi.fn()

class FakeAsyncEntry {
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
    return passwords.get(this.key)
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
  AsyncEntry: FakeAsyncEntry,
}))

const { KEYRING_SERVICE, KeyringBackend } = await import('./keyring-backend.js')

beforeEach(() => {
  passwords.clear()
  setPassword.mockClear()
  getPassword.mockClear()
  deletePassword.mockClear()
})

describe('KeyringBackend', () => {
  it('uses service name "difyctl"', () => {
    expect(KEYRING_SERVICE).toBe('difyctl')
  })

  it('returns undefined when no password is stored', async () => {
    const k = new KeyringBackend()
    expect(await k.get('cloud.dify.ai', 'acct-1')).toBeUndefined()
  })

  it('round-trips put/get', async () => {
    const k = new KeyringBackend()
    await k.put('cloud.dify.ai', 'acct-1', 'dfoa_x')
    expect(await k.get('cloud.dify.ai', 'acct-1')).toBe('dfoa_x')
  })

  it('keys by host::accountId', async () => {
    const k = new KeyringBackend()
    await k.put('cloud.dify.ai', 'acct-1', 'A')
    await k.put('cloud.dify.ai', 'acct-2', 'B')
    expect(await k.get('cloud.dify.ai', 'acct-1')).toBe('A')
    expect(await k.get('cloud.dify.ai', 'acct-2')).toBe('B')
  })

  it('delete removes the entry', async () => {
    const k = new KeyringBackend()
    await k.put('cloud.dify.ai', 'acct-1', 'A')
    await k.delete('cloud.dify.ai', 'acct-1')
    expect(await k.get('cloud.dify.ai', 'acct-1')).toBeUndefined()
  })

  it('delete is a no-op for missing entries', async () => {
    const k = new KeyringBackend()
    await expect(k.delete('cloud.dify.ai', 'gone')).resolves.toBeUndefined()
  })

  it('list returns empty array (keyring does not enumerate)', async () => {
    const k = new KeyringBackend()
    await k.put('cloud.dify.ai', 'acct-1', 'A')
    expect(await k.list('cloud.dify.ai')).toEqual([])
  })

  it('swallows getPassword exceptions and returns undefined', async () => {
    const k = new KeyringBackend()
    getPassword.mockImplementationOnce(() => {
      throw new Error('NoEntry')
    })
    expect(await k.get('cloud.dify.ai', 'acct-1')).toBeUndefined()
  })

  it('swallows delete exceptions', async () => {
    const k = new KeyringBackend()
    deletePassword.mockImplementationOnce(() => {
      throw new Error('NoEntry')
    })
    await expect(k.delete('cloud.dify.ai', 'acct-1')).resolves.toBeUndefined()
  })

  it('lets put propagate exceptions (caller decides fallback)', async () => {
    const k = new KeyringBackend()
    setPassword.mockImplementationOnce(() => {
      throw new Error('keyring locked')
    })
    await expect(k.put('cloud.dify.ai', 'acct-1', 'tok')).rejects.toThrow(/keyring locked/)
  })
})
