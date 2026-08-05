import type { MemberListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '@/sys/io/streams'
import { runGetMember } from './run.js'

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

function fakeClient(envelope: MemberListResponse) {
  return { list: vi.fn(() => Promise.resolve(envelope)) }
}

describe('runGetMember', () => {
  const env: MemberListResponse = {
    page: 1,
    limit: 20,
    total: 2,
    has_more: false,
    data: [
      { id: 'acct-1', name: 'Me', email: 'me@example.com', role: 'owner', status: 'active' },
      { id: 'acct-2', name: 'Mate', email: 'mate@example.com', role: 'admin', status: 'active' },
    ],
  }

  it('lists members and marks the calling account with current=true', async () => {
    const client = fakeClient(env)
    const r = await runGetMember(
      {},
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.list).toHaveBeenCalledExactlyOnceWith('550e8400-e29b-41d4-a716-446655440000', {
      page: 1,
      limit: 20,
    })
    expect(r.workspaceId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(r.data.rows.map((row) => row.current)).toEqual([true, false])
    expect(r.data.rows.map((row) => row.id)).toEqual(['acct-1', 'acct-2'])
  })

  it('-w flag overrides resolved workspace', async () => {
    const client = fakeClient(env)
    const r = await runGetMember(
      { workspace: '550e8400-e29b-41d4-a716-446655440008' },
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.list).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440008', {
      page: 1,
      limit: 20,
    })
    expect(r.workspaceId).toBe('550e8400-e29b-41d4-a716-446655440008')
  })

  it('--page/--limit are forwarded to the client', async () => {
    const client = fakeClient(env)
    await runGetMember(
      { page: 3, limitRaw: '50' },
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.list).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', {
      page: 3,
      limit: 50,
    })
  })

  it('marks no row when active context has no account id', async () => {
    const client = fakeClient(env)
    const a: ActiveContext = {
      host: 'cloud.dify.ai',
      email: 'me@example.com',
      ctx: {
        account: { id: '', email: '', name: '' },
        workspace: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Default', role: 'owner' },
      },
    }
    const r = await runGetMember(
      {},
      {
        active: a,
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(r.data.rows.every((row) => !row.current)).toBe(true)
  })

  it('throws when no workspace can be resolved', async () => {
    const client = fakeClient(env)
    const noWs: ActiveContext = {
      host: 'cloud.dify.ai',
      email: 'me@example.com',
      ctx: { account: { id: 'acct-1', email: 'me@example.com', name: 'Me' } },
    }
    await expect(
      runGetMember(
        {},
        {
          active: noWs,
          http: {} as HttpClient,
          io: bufferStreams(),
          envLookup: () => undefined,
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/no workspace selected/)
    expect(client.list).not.toHaveBeenCalled()
  })
})

describe('MemberListOutput shape', () => {
  it('builds table with CURRENT marker column', async () => {
    const env: MemberListResponse = {
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
      data: [
        { id: 'acct-1', name: 'Me', email: 'me@example.com', role: 'owner', status: 'active' },
      ],
    }
    const client = fakeClient(env)
    const r = await runGetMember(
      {},
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(r.data.tableColumns().map((c) => c.name)).toEqual([
      'ID',
      'NAME',
      'EMAIL',
      'ROLE',
      'STATUS',
      'CURRENT',
    ])
    expect(r.data.tableRows()[0]?.[5]).toBe('*')
    expect(r.data.name()).toBe('acct-1')
    expect(r.data.json().data[0]?.email).toBe('me@example.com')
  })
})
