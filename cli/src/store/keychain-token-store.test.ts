import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

type EntryArgs = { service: string, username: string }

const passwords = new Map<string, string>()
const constructed: EntryArgs[] = []
let getPasswordError: Error | null = null
let setPasswordError: Error | null = null

class FakeEntry {
  private readonly key: string
  constructor(service: string, username: string) {
    constructed.push({ service, username })
    this.key = `${service}::${username}`
  }

  setPassword(value: string): void {
    if (setPasswordError !== null)
      throw setPasswordError
    passwords.set(this.key, value)
  }

  getPassword(): string | null {
    if (getPasswordError !== null)
      throw getPasswordError
    return passwords.get(this.key) ?? null
  }

  deletePassword(): boolean {
    if (!passwords.has(this.key))
      return false
    passwords.delete(this.key)
    return true
  }
}

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: FakeEntry,
}))

const { KeychainTokenStore } = await import('./token-store')

const SERVICE = 'difyctl-test'

beforeEach(() => {
  passwords.clear()
  constructed.length = 0
  getPasswordError = null
  setPasswordError = null
})

describe('KeychainTokenStore', () => {
  it('round-trips a bearer through write/read', async () => {
    const store = new KeychainTokenStore(SERVICE)
    await store.write('https://cloud.dify.ai', 'a@x.com', 'dfoa_secret')
    expect(await store.read('https://cloud.dify.ai', 'a@x.com')).toBe('dfoa_secret')
  })

  it('returns empty string for an absent credential', async () => {
    const store = new KeychainTokenStore(SERVICE)
    expect(await store.read('https://cloud.dify.ai', 'missing@x.com')).toBe('')
  })

  it('removes a credential, after which read returns empty string', async () => {
    const store = new KeychainTokenStore(SERVICE)
    await store.write('h', 'e', 'dfoa_secret')
    await store.remove('h', 'e')
    expect(await store.read('h', 'e')).toBe('')
  })

  it('treats remove of an absent credential as a no-op', async () => {
    const store = new KeychainTokenStore(SERVICE)
    await expect(store.remove('h', 'absent')).resolves.not.toThrow()
  })

  it('uses the legacy entry name tokens.<host>.<email> (back-compat)', async () => {
    const store = new KeychainTokenStore(SERVICE)
    await store.write('https://cloud.dify.ai', 'a@x.com', 'dfoa_secret')
    expect(constructed).toContainEqual({
      service: SERVICE,
      username: 'tokens.https://cloud.dify.ai.a@x.com',
    })
  })

  it('keeps host and email literal — dots, colons, and @ are never split', async () => {
    const store = new KeychainTokenStore(SERVICE)
    const host = 'https://my.dify.example.com:8443'
    const email = 'first.last@sub.example.com'
    await store.write(host, email, 'dfoa_literal')
    expect(await store.read(host, email)).toBe('dfoa_literal')
    expect(constructed).toContainEqual({
      service: SERVICE,
      username: `tokens.${host}.${email}`,
    })
  })

  it('returns empty string when the stored value decodes to a non-string', async () => {
    const store = new KeychainTokenStore(SERVICE)
    passwords.set(`${SERVICE}::tokens.h.e`, '123')
    expect(await store.read('h', 'e')).toBe('')
  })

  it('returns empty string when the stored value is not valid JSON', async () => {
    const store = new KeychainTokenStore(SERVICE)
    passwords.set(`${SERVICE}::tokens.h.e`, 'not-json')
    expect(await store.read('h', 'e')).toBe('')
  })

  it('throws KeyringUnavailable (not empty string) when keyring access fails on read', async () => {
    getPasswordError = new Error('keyring locked')
    const store = new KeychainTokenStore(SERVICE)
    let caught: unknown
    try {
      await store.read('h', 'e')
    }
    catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BaseError)
    expect((caught as BaseError).code).toBe(ErrorCode.KeyringUnavailable)
  })

  it('throws KeyringUnavailable when keyring access fails on write', async () => {
    setPasswordError = new Error('keyring locked')
    const store = new KeychainTokenStore(SERVICE)
    let caught: unknown
    try {
      await store.write('h', 'e', 'dfoa_secret')
    }
    catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BaseError)
    expect((caught as BaseError).code).toBe(ErrorCode.KeyringUnavailable)
  })
})
