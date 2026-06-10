import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useTempConfigDir } from '@test/fixtures/config-dir'
import { MemStore } from '@test/fixtures/mem-store'
import { describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { bufferStreams } from '@/sys/io/streams'
import { runLogout } from './logout.js'

describe('runLogout', () => {
  const dir = useTempConfigDir('difyctl-logout-')

  function seed(store: MemStore) {
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h1', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.save()
    store.write('h1', 'a@x', 'dfoa_a')
    store.write('h1', 'b@x', 'dfoa_b')
  }

  it('removes only the active context, keeps others, unsets pointers, file survives', async () => {
    const store = new MemStore()
    seed(store)
    await runLogout({ io: bufferStreams(), reg: Registry.load(), store })
    const after = Registry.load()
    expect(after?.hosts.h1?.accounts['a@x']).toBeUndefined()
    expect(after?.hosts.h1?.accounts['b@x']).toBeDefined()
    expect(after?.current_host).toBeUndefined()
    expect(store.read('h1', 'a@x')).toBe('')
    expect(store.read('h1', 'b@x')).toBe('dfoa_b')
    const raw = await readFile(join(dir(), 'hosts.yml'), 'utf8')
    expect(raw).toContain('b@x')
  })

  it('clears local credentials even when the store.read throws (e.g. keyring locked)', async () => {
    const store = new MemStore()
    seed(store)
    store.read = () => {
      throw new Error('keyring locked')
    }
    await runLogout({ io: bufferStreams(), reg: Registry.load(), store })
    const after = Registry.load()
    expect(after?.hosts.h1?.accounts['a@x']).toBeUndefined()
  })

  it('throws NotLoggedIn when no active context', async () => {
    Registry.empty('file').save()
    await expect(runLogout({ io: bufferStreams(), reg: Registry.load(), store: new MemStore() }))
      .rejects
      .toThrow(/not logged in/i)
  })
})
