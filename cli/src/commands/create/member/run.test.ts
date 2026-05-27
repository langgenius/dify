import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '../../../sys/io/streams.js'
import { runCreateMember } from './run.js'

function bundle(): HostsBundle {
  return {
    current_host: 'cloud.dify.ai',
    token_storage: 'file',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'inviter@example.com', name: 'Inviter' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [{ id: 'ws-1', name: 'Default', role: 'owner' }],
  }
}

function fakeClient() {
  return {
    invite: vi.fn((_ws: string, body: { email: string, role: string }) =>
      Promise.resolve({
        result: 'success' as const,
        email: body.email.toLowerCase(),
        role: body.role,
        member_id: 'acct-new',
        invite_url: 'https://console.example.com/activate?email=x&token=tok',
        tenant_id: 'ws-1',
      })),
  }
}

describe('runCreateMember', () => {
  it('happy path: POSTs invite, returns InviteOutput with text/json/name', async () => {
    const client = fakeClient()
    const result = await runCreateMember(
      { email: 'new@example.com', role: 'normal' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.invite).toHaveBeenCalledWith('ws-1', { email: 'new@example.com', role: 'normal' })
    expect(result.data.text()).toMatch(/Invited new@example\.com as normal/)
    expect(result.data.name()).toBe('acct-new')
    expect(result.data.json()).toMatchObject({
      email: 'new@example.com',
      role: 'normal',
      member_id: 'acct-new',
      invite_url: 'https://console.example.com/activate?email=x&token=tok',
      tenant_id: 'ws-1',
    })
    expect(result.workspaceId).toBe('ws-1')
  })

  it('rejects unknown role before any HTTP call', async () => {
    const client = fakeClient()
    await expect(
      runCreateMember(
        { email: 'new@example.com', role: 'owner' },
        {
          bundle: bundle(),
          http: {} as KyInstance,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/invalid --role/)
    expect(client.invite).not.toHaveBeenCalled()
  })

  it('rejects empty email', async () => {
    const client = fakeClient()
    await expect(
      runCreateMember(
        { email: '', role: 'normal' },
        {
          bundle: bundle(),
          http: {} as KyInstance,
          io: bufferStreams(),
          membersFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/--email is required/)
    expect(client.invite).not.toHaveBeenCalled()
  })

  it('-w flag overrides resolved workspace', async () => {
    const client = fakeClient()
    await runCreateMember(
      { email: 'new@example.com', role: 'admin', workspace: 'ws-9' },
      {
        bundle: bundle(),
        http: {} as KyInstance,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.invite).toHaveBeenCalledWith('ws-9', { email: 'new@example.com', role: 'admin' })
  })
})
