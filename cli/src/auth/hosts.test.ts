import type { AccountContext } from './hosts'
import { useTempConfigDir } from '@test/fixtures/config-dir'
import { MemStore } from '@test/fixtures/mem-store'
import { describe, expect, it } from 'vitest'
import { AccountContextSchema, notLoggedInError, Registry, RegistrySchema } from './hosts'

describe('RegistrySchema', () => {
  it('parses an empty registry with defaults', () => {
    const reg = RegistrySchema.parse({})
    expect(reg.token_storage).toBe('file')
    expect(reg.current_host).toBeUndefined()
    expect(reg.hosts).toEqual({})
  })

  it('parses a populated multi-host registry', () => {
    const reg = RegistrySchema.parse({
      token_storage: 'keychain',
      current_host: 'cloud.dify.ai',
      hosts: {
        'cloud.dify.ai': {
          current_account: 'bob@corp.com',
          accounts: {
            'bob@corp.com': {
              account: { id: 'acct-1', email: 'bob@corp.com', name: 'Bob' },
              workspace: { id: 'ws-1', name: 'Space', role: 'owner' },
              token_id: 'tok_1',
            },
          },
        },
      },
    })
    expect(reg.current_host).toBe('cloud.dify.ai')
    expect(reg.hosts['cloud.dify.ai']?.current_account).toBe('bob@corp.com')
    expect(reg.hosts['cloud.dify.ai']?.accounts['bob@corp.com']?.account.name).toBe('Bob')
  })

  it('defaults a host entry accounts map to {}', () => {
    const reg = RegistrySchema.parse({ hosts: { h: { current_account: 'x' } } })
    expect(reg.hosts.h?.accounts).toEqual({})
  })

  it('rejects unknown token_storage values', () => {
    expect(() => RegistrySchema.parse({ token_storage: 'cloud' })).toThrow()
  })

  it('AccountContextSchema keeps optional external_subject', () => {
    const ctx = AccountContextSchema.parse({
      account: { id: '', email: 'sso@x.io', name: '' },
      external_subject: { email: 'sso@x.io', issuer: 'https://issuer' },
    })
    expect(ctx.external_subject?.issuer).toBe('https://issuer')
  })

  it('strips a stale available_workspaces field from legacy contexts', () => {
    const raw = {
      account: { id: 'acct-1', email: 'bob@corp.com', name: 'Bob' },
      workspace: { id: 'ws-1', name: 'Space', role: 'owner' },
      available_workspaces: [
        { id: 'ws-1', name: 'Space', role: 'owner' },
        { id: '00000000-0000-0000-0000-000000000002', name: 'Other', role: 'normal' },
      ],
    } as unknown as Record<string, unknown>
    const ctx = AccountContextSchema.parse(raw)
    expect((ctx as Record<string, unknown>).available_workspaces).toBeUndefined()
    expect(ctx.workspace?.id).toBe('ws-1')
  })
})

describe('notLoggedInError', () => {
  it('carries the default hint', () => {
    expect(notLoggedInError().toString()).toMatch(/auth login/)
  })
  it('accepts a custom hint', () => {
    expect(notLoggedInError('run \'difyctl use host\'').toString()).toMatch(/use host/)
  })
})

describe('Registry (pure)', () => {
  const baseReg = (): Registry => Registry.empty('file')
  const ctx = (email: string): AccountContext => ({ account: { id: `id-${email}`, email, name: email } })

  it('upsert creates host + account; remove drops them', () => {
    const reg = baseReg()
    reg.upsert('h1', 'a@x', ctx('a@x'))
    reg.upsert('h1', 'b@x', ctx('b@x'))
    expect(reg.hosts.h1?.accounts['a@x']?.account.email).toBe('a@x')
    reg.remove('h1', 'a@x')
    expect(reg.hosts.h1?.accounts['a@x']).toBeUndefined()
    expect(reg.hosts.h1?.accounts['b@x']).toBeDefined()
    reg.remove('h1', 'b@x')
    expect(reg.hosts.h1).toBeUndefined()
  })

  it('setHost / setAccount set pointers', () => {
    const reg = baseReg()
    reg.upsert('h1', 'a@x', ctx('a@x'))
    reg.setHost('h1')
    reg.setAccount('a@x')
    expect(reg.current_host).toBe('h1')
    expect(reg.hosts.h1?.current_account).toBe('a@x')
  })

  it('resolveActive returns the active context with scheme', () => {
    const reg = baseReg()
    reg.upsert('h1', 'a@x', ctx('a@x'))
    reg.setScheme('h1', 'http')
    reg.setHost('h1')
    reg.setAccount('a@x')
    const active = reg.resolveActive()
    expect(active?.host).toBe('h1')
    expect(active?.email).toBe('a@x')
    expect(active?.scheme).toBe('http')
    expect(active?.ctx.account.email).toBe('a@x')
  })

  it('resolveActive returns the active context with insecureTls', () => {
    const reg = baseReg()
    reg.upsert('h1', 'a@x', ctx('a@x'))
    reg.setInsecureTls('h1', true)
    reg.setHost('h1')
    reg.setAccount('a@x')
    expect(reg.resolveActive()?.insecureTls).toBe(true)
  })

  it('setInsecureTls is a no-op for an unknown host', () => {
    const reg = baseReg()
    reg.setInsecureTls('missing', true)
    expect(reg.hosts.missing).toBeUndefined()
  })

  it('resolveActive returns undefined for each missing pointer', () => {
    const reg = baseReg()
    expect(reg.resolveActive()).toBeUndefined()
    reg.upsert('h1', 'a@x', ctx('a@x'))
    reg.setHost('missing')
    expect(reg.resolveActive()).toBeUndefined()
    reg.setHost('h1')
    expect(reg.resolveActive()).toBeUndefined()
    reg.setAccount('missing@x')
    expect(reg.resolveActive()).toBeUndefined()
  })

  it('remove unsets pointers when removing the active account', () => {
    const reg = baseReg()
    reg.upsert('h1', 'a@x', ctx('a@x'))
    reg.setHost('h1')
    reg.setAccount('a@x')
    reg.remove('h1', 'a@x')
    expect(reg.current_host).toBeUndefined()
    expect(reg.resolveActive()).toBeUndefined()
  })
})

describe('Registry.load / Registry.save', () => {
  useTempConfigDir('difyctl-reg-')

  it('returns an empty registry when nothing saved', async () => {
    const reg = await Registry.load()
    expect(reg.current_host).toBeUndefined()
    expect(Object.keys(reg.hosts)).toHaveLength(0)
  })

  it('round-trips a populated registry', async () => {
    const reg = Registry.empty('keychain')
    reg.upsert('cloud.dify.ai', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.setHost('cloud.dify.ai')
    reg.setAccount('a@x')
    await reg.save()
    const loaded = await Registry.load()
    expect(loaded?.current_host).toBe('cloud.dify.ai')
    expect(loaded?.hosts['cloud.dify.ai']?.accounts['a@x']?.account.email).toBe('a@x')
  })
})

describe('Registry.forget', () => {
  useTempConfigDir('difyctl-forget-')

  it('drops token + active context, keeps siblings, unsets pointers', async () => {
    const store = new MemStore()
    const reg = Registry.empty('file')
    reg.upsert('h1', 'a@x', { account: { id: '1', email: 'a@x', name: 'A' } })
    reg.upsert('h1', 'b@x', { account: { id: '2', email: 'b@x', name: 'B' } })
    reg.setHost('h1')
    reg.setAccount('a@x')
    await reg.save()
    await store.write('h1', 'a@x', 'dfoa_a')

    const active = reg.resolveActive()!
    await reg.forget(active, store)

    expect(await store.read('h1', 'a@x')).toBe('')
    const after = await Registry.load()
    expect(after?.hosts.h1?.accounts['a@x']).toBeUndefined()
    expect(after?.hosts.h1?.accounts['b@x']).toBeDefined()
    expect(after?.current_host).toBeUndefined()
  })
})
