import type { Key, Store } from '@/store/store'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { ENV_CONFIG_DIR } from '@/store/dir'
import { bufferStreams } from '@/sys/io/streams'
import { runLogout } from './logout.js'

class MemStore implements Store {
  readonly entries = new Map<string, unknown>()
  get<T>(key: Key<T>): T { return (this.entries.get(key.key) as T | undefined) ?? key.default }
  set<T>(key: Key<T>, value: T): void { this.entries.set(key.key, value) }
  unset<T>(key: Key<T>): void { this.entries.delete(key.key) }
}

describe('runLogout', () => {
  let dir: string
  let prev: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-logout-'))
    prev = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = dir
  })
  afterEach(async () => {
    if (prev === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else process.env[ENV_CONFIG_DIR] = prev
    await rm(dir, { recursive: true, force: true })
  })

  function seed(store: MemStore) {
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h1', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.save()
    store.set({ key: 'tokens.h1.a@x', default: '' }, 'dfoa_a')
    store.set({ key: 'tokens.h1.b@x', default: '' }, 'dfoa_b')
  }

  it('removes only the active context, keeps others, unsets pointers, file survives', async () => {
    const store = new MemStore()
    seed(store)
    await runLogout({ io: bufferStreams(), reg: Registry.load(), store })
    const after = Registry.load()
    expect(after?.hosts.h1?.accounts['a@x']).toBeUndefined()
    expect(after?.hosts.h1?.accounts['b@x']).toBeDefined()
    expect(after?.current_host).toBeUndefined()
    expect(store.get({ key: 'tokens.h1.a@x', default: '' })).toBe('')
    expect(store.get({ key: 'tokens.h1.b@x', default: '' })).toBe('dfoa_b')
    const raw = await readFile(join(dir, 'hosts.yml'), 'utf8')
    expect(raw).toContain('b@x')
  })

  it('throws NotLoggedIn when no active context', async () => {
    Registry.empty('file').save()
    await expect(runLogout({ io: bufferStreams(), reg: Registry.load(), store: new MemStore() }))
      .rejects
      .toThrow(/not logged in/i)
  })
})
