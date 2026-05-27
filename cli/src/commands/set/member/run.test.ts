import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '../../../sys/io/streams'
import { runSetMember } from './run.js'

function bundle(): HostsBundle {
  return {
    current_host: 'cloud.dify.ai',
    token_storage: 'file',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'me@example.com', name: 'Me' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [{ id: 'ws-1', name: 'Default', role: 'owner' }],
  }
}

function fakeClient() {
  return {
    updateRole: vi.fn(() => Promise.resolve({ result: 'success' as const })),
  }
}

describe('runSetMember', () => {
  it('happy path: PUT new role, returns SetMemberOutput with text/json/name', async () => {
    const client = fakeClient()
    const result = await runSetMember(
      { memberId: 'acct-2', role: 'admin' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.updateRole).toHaveBeenCalledExactlyOnceWith('ws-1', 'acct-2', { role: 'admin' })
    expect(result.data.text()).toMatch(/Set acct-2 role to admin/)
    expect(result.data.name()).toBe('acct-2')
    expect(result.data.json()).toEqual({ id: 'acct-2', role: 'admin' })
    expect(result.workspaceId).toBe('ws-1')
  })

  it('rejects unknown role before any HTTP call', async () => {
    const client = fakeClient()
    await expect(
      runSetMember(
        { memberId: 'acct-2', role: 'owner' },
        {
          bundle: bundle(),
          http: {} as KyInstance,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/invalid --role/)
    expect(client.updateRole).not.toHaveBeenCalled()
  })

  it('rejects empty member id', async () => {
    const client = fakeClient()
    await expect(
      runSetMember(
        { memberId: '', role: 'admin' },
        {
          bundle: bundle(),
          http: {} as KyInstance,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/member id is required/)
  })

  it('-w flag overrides resolved workspace', async () => {
    const client = fakeClient()
    await runSetMember(
      { memberId: 'acct-2', role: 'normal', workspace: 'ws-9' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.updateRole).toHaveBeenCalledWith('ws-9', 'acct-2', { role: 'normal' })
  })
})
