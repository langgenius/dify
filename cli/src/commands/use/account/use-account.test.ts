import { useTempConfigDir } from '@test/fixtures/config-dir'
import { MemStore } from '@test/fixtures/mem-store'
import { beforeEach, describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { bufferStreams } from '@/sys/io/streams'
import { runUseAccount } from './use-account'

describe('runUseAccount', () => {
  useTempConfigDir('difyctl-useacct-')
  beforeEach(() => {
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h1', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.save()
  })

  it('switches current_account when email valid + token present', async () => {
    await runUseAccount({ io: bufferStreams(), email: 'b@x', store: new MemStore({ 'h1 b@x': 'dfoa_b' }) })
    expect(Registry.load().hosts.h1?.current_account).toBe('b@x')
  })

  it('errors when the account has no stored token', async () => {
    await expect(runUseAccount({ io: bufferStreams(), email: 'b@x', store: new MemStore({}) }))
      .rejects
      .toThrow(/log in|no credential/i)
  })

  it('errors when the email is unknown on the current host', async () => {
    await expect(runUseAccount({ io: bufferStreams(), email: 'z@x', store: new MemStore({ 'h1 z@x': 'x' }) }))
      .rejects
      .toThrow(/unknown account|no account/i)
  })

  it('errors in non-TTY when email omitted', async () => {
    const io = bufferStreams()
    ;(io as { isErrTTY: boolean }).isErrTTY = false
    await expect(runUseAccount({ io, email: undefined, store: new MemStore({}) })).rejects.toThrow(/--email/i)
  })
})
