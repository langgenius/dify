import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '../../../sys/io/streams.js'
import { runDeleteMember } from './run.js'

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
    remove: vi.fn(() => Promise.resolve({ result: 'success' as const })),
  }
}

describe('runDeleteMember', () => {
  it('happy path: DELETE, returns DeleteMemberOutput with text/json/name', async () => {
    const client = fakeClient()
    const result = await runDeleteMember(
      { memberId: 'acct-2' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.remove).toHaveBeenCalledExactlyOnceWith('ws-1', 'acct-2')
    expect(result.data.text()).toMatch(/Removed acct-2/)
    expect(result.data.name()).toBe('acct-2')
    expect(result.data.json()).toEqual({ id: 'acct-2', deleted: true })
    expect(result.workspaceId).toBe('ws-1')
  })

  it('-w flag overrides resolved workspace', async () => {
    const client = fakeClient()
    await runDeleteMember(
      { memberId: 'acct-2', workspace: 'ws-9' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.remove).toHaveBeenCalledWith('ws-9', 'acct-2')
  })

  it('rejects empty member id before any HTTP call', async () => {
    const client = fakeClient()
    await expect(
      runDeleteMember(
        { memberId: '' },
        {
          bundle: bundle(),
          http: {} as KyInstance,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/member id is required/)
    expect(client.remove).not.toHaveBeenCalled()
  })
})
