import type { HostsBundle } from '../../../auth/hosts.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadHosts, saveHosts } from '../../../auth/hosts.js'
import { bufferStreams } from '../../../io/streams.js'
import { runUse } from './use.js'

function accountBundle(): HostsBundle {
  return {
    current_host: 'cloud.dify.ai',
    token_storage: 'file',
    token_id: 'tok-1',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Test Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Other', role: 'normal' },
    ],
  }
}

describe('runUse', () => {
  let configDir: string
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'difyctl-use-'))
  })
  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true })
  })

  it('switches workspace + persists hosts.yml', async () => {
    const io = bufferStreams()
    const b = accountBundle()
    await saveHosts(configDir, b)
    const next = await runUse({ configDir, io, bundle: b, workspaceId: 'ws-2' })
    expect(next.workspace).toEqual({ id: 'ws-2', name: 'Other', role: 'normal' })
    const reloaded = await loadHosts(configDir)
    expect(reloaded?.workspace?.id).toBe('ws-2')
    expect(io.outBuf()).toContain('Switched to workspace Other (ws-2)')
  })

  it('not-logged-in: throws NotLoggedIn', async () => {
    const io = bufferStreams()
    await expect(runUse({ configDir, io, bundle: undefined, workspaceId: 'ws-1' }))
      .rejects
      .toThrow(/not logged in/)
  })

  it('sso: throws workspace-unavailable', async () => {
    const io = bufferStreams()
    const b: HostsBundle = {
      current_host: 'cloud.dify.ai',
      token_storage: 'file',
      tokens: { bearer: 'dfoe_test' },
      external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
    }
    await expect(runUse({ configDir, io, bundle: b, workspaceId: 'ws-1' }))
      .rejects
      .toThrow(/workspace context unavailable/)
  })

  it('unknown workspace: throws UsageMissingArg', async () => {
    const io = bufferStreams()
    await expect(runUse({ configDir, io, bundle: accountBundle(), workspaceId: 'ws-bogus' }))
      .rejects
      .toThrow(/ws-bogus.*not found/)
  })
})
