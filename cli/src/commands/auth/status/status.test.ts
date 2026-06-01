import { describe, expect, it } from 'vitest'
import { Registry } from '@/auth/hosts'
import { bufferStreams } from '@/sys/io/streams'
import { runStatus } from './status'

function accountReg(): Registry {
  return Registry.from({
    token_storage: 'keychain',
    current_host: 'cloud.dify.ai',
    hosts: {
      'cloud.dify.ai': {
        current_account: 'tester@dify.ai',
        accounts: {
          'tester@dify.ai': {
            account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
            workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
            available_workspaces: [
              { id: 'ws-1', name: 'Default', role: 'owner' },
              { id: 'ws-2', name: 'Other', role: 'normal' },
            ],
            token_id: 'tok-1',
          },
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
            account: { id: '', email: '', name: '' },
            external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
          },
        },
      },
    },
  })
}

describe('runStatus', () => {
  it('logged-out: prints message + throws NotLoggedIn', async () => {
    const io = bufferStreams()
    await expect(runStatus({ io, reg: Registry.empty() })).rejects.toThrow(/not logged in/)
    expect(io.outBuf()).toContain('Not logged in')
  })

  it('logged-out json: emits {logged_in: false}', async () => {
    const io = bufferStreams()
    await expect(runStatus({ io, reg: Registry.empty(), json: true })).rejects.toThrow(/not logged in/)
    expect(JSON.parse(io.outBuf())).toEqual({ host: null, logged_in: false })
  })

  it('account: human compact', async () => {
    const io = bufferStreams()
    await runStatus({ io, reg: accountReg() })
    const out = io.outBuf()
    expect(out).toContain('Logged in to cloud.dify.ai as tester@dify.ai (Test Tester)')
    expect(out).toContain('Workspace: Default')
    expect(out).toContain('full access')
  })

  it('account verbose: shows ids + storage + workspace count', async () => {
    const io = bufferStreams()
    await runStatus({ io, reg: accountReg(), verbose: true })
    const out = io.outBuf()
    expect(out).toContain('cloud.dify.ai')
    expect(out).toContain('Account:')
    expect(out).toContain('acct-1')
    expect(out).toContain('Workspace: Default (ws-1, role: owner)')
    expect(out).toContain('Available: 2 workspaces')
    expect(out).toContain('Storage:   keychain')
    expect(out).toContain('Contexts:')
  })

  it('sso: human compact mentions issuer', async () => {
    const io = bufferStreams()
    await runStatus({ io, reg: ssoReg() })
    const out = io.outBuf()
    expect(out).toContain('sso@dify.ai (via https://issuer.example)')
    expect(out).toContain('apps:run')
  })

  it('account json: matches schema with workspace + workspace count', async () => {
    const io = bufferStreams()
    await runStatus({ io, reg: accountReg(), json: true })
    const parsed = JSON.parse(io.outBuf()) as Record<string, unknown>
    expect(parsed.host).toBe('cloud.dify.ai')
    expect(parsed.logged_in).toBe(true)
    expect(parsed.storage).toBe('keychain')
    expect(parsed.account).toEqual({ id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' })
    expect(parsed.workspace).toEqual({ id: 'ws-1', name: 'Default', role: 'owner' })
    expect(parsed.available_workspaces_count).toBe(2)
  })

  it('sso json: subject_type external_sso + email + issuer, no account', async () => {
    const io = bufferStreams()
    await runStatus({ io, reg: ssoReg(), json: true })
    const parsed = JSON.parse(io.outBuf()) as Record<string, unknown>
    expect(parsed.subject_type).toBe('external_sso')
    expect(parsed.subject_email).toBe('sso@dify.ai')
    expect(parsed.subject_issuer).toBe('https://issuer.example')
    expect(parsed.account).toBeUndefined()
  })
})
