import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '@/sys/io/streams'
import { runDeleteMember } from './run.js'

function active(): ActiveContext {
  return {
    host: 'cloud.dify.ai',
    email: 'me@example.com',
    ctx: {
      account: { id: 'acct-1', email: 'me@example.com', name: 'Me' },
      workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
      available_workspaces: [{ id: 'ws-1', name: 'Default', role: 'owner' }],
    },
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
        active: active(),
        http: {} as HttpClient,
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
        active: active(),
        http: {} as HttpClient,
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
          active: active(),
          http: {} as HttpClient,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/member id is required/)
    expect(client.remove).not.toHaveBeenCalled()
  })
})
