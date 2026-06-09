import type { TokenStore } from '@/store/token-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { ENV_CONFIG_DIR } from '@/store/dir'
import { bufferStreams } from '@/sys/io/streams'
import { runUseAccount } from './use-account'

function memStore(seed: Record<string, string>): TokenStore {
  const k = (host: string, email: string): string => `${host} ${email}`
  const m = new Map<string, string>(Object.entries(seed))
  return {
    read(host: string, email: string): string { return m.get(k(host, email)) ?? '' },
    write(host: string, email: string, bearer: string): void { m.set(k(host, email), bearer) },
    remove(host: string, email: string): void { m.delete(k(host, email)) },
  }
}

describe('runUseAccount', () => {
  let dir: string
  let prev: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-useacct-'))
    prev = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = dir
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h1', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.save()
  })
  afterEach(async () => {
    if (prev === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else process.env[ENV_CONFIG_DIR] = prev
    await rm(dir, { recursive: true, force: true })
  })

  it('switches current_account when email valid + token present', async () => {
    await runUseAccount({ io: bufferStreams(), email: 'b@x', store: memStore({ 'h1 b@x': 'dfoa_b' }) })
    expect(Registry.load().hosts.h1?.current_account).toBe('b@x')
  })

  it('errors when the account has no stored token', async () => {
    await expect(runUseAccount({ io: bufferStreams(), email: 'b@x', store: memStore({}) }))
      .rejects
      .toThrow(/log in|no credential/i)
  })

  it('errors when the email is unknown on the current host', async () => {
    await expect(runUseAccount({ io: bufferStreams(), email: 'z@x', store: memStore({ 'h1 z@x': 'x' }) }))
      .rejects
      .toThrow(/unknown account|no account/i)
  })

  it('errors in non-TTY when email omitted', async () => {
    const io = bufferStreams()
    ;(io as { isErrTTY: boolean }).isErrTTY = false
    await expect(runUseAccount({ io, email: undefined, store: memStore({}) })).rejects.toThrow(/--email/i)
  })
})
