import { describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { bufferStreams } from '@/sys/io/streams'
import { runWhoami } from './whoami'

function accountReg(): Registry {
  return Registry.from({
    token_storage: 'file',
    current_host: 'cloud.dify.ai',
    hosts: {
      'cloud.dify.ai': {
        current_account: 'a@b.c',
        accounts: {
          'a@b.c': { account: { id: 'acct-1', email: 'a@b.c', name: 'Ann' } },
        },
      },
    },
  })
}

function ssoReg(): Registry {
  return Registry.from({
    token_storage: 'file',
    current_host: 'cloud.dify.ai',
    hosts: {
      'cloud.dify.ai': {
        current_account: 'sso@dify.ai',
        accounts: {
          'sso@dify.ai': {
            account: { email: 'sso@dify.ai', name: '' },
            external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
          },
        },
      },
    },
  })
}

describe('runWhoami', () => {
  it('throws NotLoggedIn when no active context', async () => {
    await expect(runWhoami({ io: bufferStreams(), reg: Registry.empty() })).rejects.toThrow(
      /not logged in/i,
    )
  })

  it('prints email + name for an account', async () => {
    const io = bufferStreams()
    await runWhoami({ io, reg: accountReg() })
    expect(io.outBuf()).toContain('a@b.c')
    expect(io.outBuf()).toContain('Ann')
  })

  it('account human: emits "email (name)"', async () => {
    const io = bufferStreams()
    await runWhoami({ io, reg: accountReg() })
    expect(io.outBuf()).toBe('a@b.c (Ann)\n')
  })

  it('account human, no name: emits email only', async () => {
    const io = bufferStreams()
    const reg = accountReg()
    reg.hosts['cloud.dify.ai']!.accounts['a@b.c']!.account.name = ''
    await runWhoami({ io, reg })
    expect(io.outBuf()).toBe('a@b.c\n')
  })

  it('emits JSON when --json', async () => {
    const io = bufferStreams()
    await runWhoami({ io, reg: accountReg(), json: true })
    expect(JSON.parse(io.outBuf())).toMatchObject({ email: 'a@b.c', id: 'acct-1' })
  })

  it('account json: emits {id, email, name}', async () => {
    const io = bufferStreams()
    await runWhoami({ io, reg: accountReg(), json: true })
    expect(JSON.parse(io.outBuf())).toEqual({
      id: 'acct-1',
      email: 'a@b.c',
      name: 'Ann',
    })
  })

  it('sso human: emits email + issuer', async () => {
    const io = bufferStreams()
    await runWhoami({ io, reg: ssoReg() })
    expect(io.outBuf()).toBe('sso@dify.ai (external SSO, issuer: https://issuer.example)\n')
  })

  it('sso json: emits {subject_type, email, issuer}', async () => {
    const io = bufferStreams()
    await runWhoami({ io, reg: ssoReg(), json: true })
    expect(JSON.parse(io.outBuf())).toEqual({
      subject_type: 'external_sso',
      email: 'sso@dify.ai',
      issuer: 'https://issuer.example',
    })
  })
})
