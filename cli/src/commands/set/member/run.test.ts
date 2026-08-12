import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '@/sys/io/streams'
import { runSetMember } from './run.js'

function active(): ActiveContext {
  return {
    host: 'cloud.dify.ai',
    email: 'me@example.com',
    ctx: {
      account: { id: 'acct-1', email: 'me@example.com', name: 'Me' },
      workspace: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Default', role: 'owner' },
    },
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
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.updateRole).toHaveBeenCalledExactlyOnceWith(
      '550e8400-e29b-41d4-a716-446655440000',
      'acct-2',
      { role: 'admin' },
    )
    expect(result.data.text()).toMatch(/Set acct-2 role to admin/)
    expect(result.data.name()).toBe('acct-2')
    expect(result.data.json()).toEqual({ id: 'acct-2', role: 'admin' })
    expect(result.workspaceId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('rejects unknown role before any HTTP call', async () => {
    const client = fakeClient()
    await expect(
      runSetMember(
        { memberId: 'acct-2', role: 'owner' },
        {
          active: active(),
          http: {} as HttpClient,
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
          active: active(),
          http: {} as HttpClient,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/member id is required/)
  })

  it('-w flag overrides resolved workspace', async () => {
    const client = fakeClient()
    await runSetMember(
      { memberId: 'acct-2', role: 'normal', workspace: '550e8400-e29b-41d4-a716-446655440008' },
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.updateRole).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440008',
      'acct-2',
      { role: 'normal' },
    )
  })
})
