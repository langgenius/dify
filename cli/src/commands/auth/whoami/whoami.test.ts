import type { HostsBundle } from '../../../auth/hosts.js'
import { describe, expect, it } from 'vitest'
import { bufferStreams } from '../../../io/streams.js'
import { runWhoami } from './whoami.js'

function accountBundle(): HostsBundle {
  return {
    current_host: 'cloud.dify.ai',
    token_storage: 'keychain',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
  }
}

describe('runWhoami', () => {
  it('logged-out: throws NotLoggedIn', async () => {
    const io = bufferStreams()
    await expect(runWhoami({ io, bundle: undefined })).rejects.toThrow(/not logged in/)
  })

  it('account human: emits "email (name)"', async () => {
    const io = bufferStreams()
    await runWhoami({ io, bundle: accountBundle() })
    expect(io.outBuf()).toBe('tester@dify.ai (Test Tester)\n')
  })

  it('account human, no name: emits email only', async () => {
    const io = bufferStreams()
    const b = accountBundle()
    b.account!.name = ''
    await runWhoami({ io, bundle: b })
    expect(io.outBuf()).toBe('tester@dify.ai\n')
  })

  it('account json: emits {id, email, name}', async () => {
    const io = bufferStreams()
    await runWhoami({ io, bundle: accountBundle(), json: true })
    expect(JSON.parse(io.outBuf())).toEqual({
      id: 'acct-1',
      email: 'tester@dify.ai',
      name: 'Test Tester',
    })
  })

  it('sso human: emits email + issuer', async () => {
    const io = bufferStreams()
    const b: HostsBundle = {
      current_host: 'cloud.dify.ai',
      token_storage: 'file',
      tokens: { bearer: 'dfoe_test' },
      external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
    }
    await runWhoami({ io, bundle: b })
    expect(io.outBuf()).toBe('sso@dify.ai (external SSO, issuer: https://issuer.example)\n')
  })

  it('sso json: emits {subject_type, email, issuer}', async () => {
    const io = bufferStreams()
    const b: HostsBundle = {
      current_host: 'cloud.dify.ai',
      token_storage: 'file',
      tokens: { bearer: 'dfoe_test' },
      external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
    }
    await runWhoami({ io, bundle: b, json: true })
    expect(JSON.parse(io.outBuf())).toEqual({
      subject_type: 'external_sso',
      email: 'sso@dify.ai',
      issuer: 'https://issuer.example',
    })
  })
})
