import type { MemberListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '../../../sys/io/streams.js'
import { runGetMember } from './run.js'

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
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.list).toHaveBeenCalledExactlyOnceWith('ws-1', { page: 1, limit: 20 })
    expect(r.workspaceId).toBe('ws-1')
    expect(r.data.rows.map(row => row.current)).toEqual([true, false])
    expect(r.data.rows.map(row => row.id)).toEqual(['acct-1', 'acct-2'])
  })

  it('-w flag overrides resolved workspace', async () => {
    const client = fakeClient(env)
    const r = await runGetMember(
      { workspace: 'ws-9' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.list).toHaveBeenCalledWith('ws-9', { page: 1, limit: 20 })
    expect(r.workspaceId).toBe('ws-9')
  })

  it('--page/--limit are forwarded to the client', async () => {
    const client = fakeClient(env)
    await runGetMember(
      { page: 3, limitRaw: '50' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.list).toHaveBeenCalledWith('ws-1', { page: 3, limit: 50 })
  })

  it('marks no row when bundle has no account id', async () => {
    const client = fakeClient(env)
    const b = bundle()
    b.account = { id: '', email: '', name: '' }
    const r = await runGetMember(
      {},
      {
        bundle: b,
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(r.data.rows.every(row => !row.current)).toBe(true)
  })

  it('throws when no workspace can be resolved', async () => {
    const client = fakeClient(env)
    await expect(
      runGetMember(
        {},
        {
          bundle: {
            current_host: '',
            token_storage: 'file',
            tokens: { bearer: 'dfoa_test' },
            account: { id: 'acct-1', email: '', name: '' },
          },
          http: {} as KyInstance,
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
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(r.data.tableColumns().map(c => c.name)).toEqual([
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
