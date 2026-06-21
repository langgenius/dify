import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { describe, expect, it, vi } from 'vitest'
import { bufferStreams } from '@/sys/io/streams'
import { runCreateMember } from './run.js'

function active(): ActiveContext {
  return {
    host: 'cloud.dify.ai',
    email: 'inviter@example.com',
    ctx: {
      account: { id: 'acct-1', email: 'inviter@example.com', name: 'Inviter' },
      workspace: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Default', role: 'owner' },
    },
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
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
      })),
  }
}

describe('runCreateMember', () => {
  it('happy path: POSTs invite, returns InviteOutput with text/json/name', async () => {
    const client = fakeClient()
    const result = await runCreateMember(
      { email: 'new@example.com', role: 'normal' },
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.invite).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', { email: 'new@example.com', role: 'normal' })
    expect(result.data.text()).toMatch(/Invited new@example\.com as normal/)
    expect(result.data.name()).toBe('acct-new')
    expect(result.data.json()).toMatchObject({
      email: 'new@example.com',
      role: 'normal',
      member_id: 'acct-new',
      invite_url: 'https://console.example.com/activate?email=x&token=tok',
      tenant_id: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.workspaceId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('rejects unknown role before any HTTP call', async () => {
    const client = fakeClient()
    await expect(
      runCreateMember(
        { email: 'new@example.com', role: 'owner' },
        {
          active: active(),
          http: {} as HttpClient,
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
          active: active(),
          http: {} as HttpClient,
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
      { email: 'new@example.com', role: 'admin', workspace: '550e8400-e29b-41d4-a716-446655440008' },
      {
        active: active(),
        http: {} as HttpClient,
        io: bufferStreams(),
        membersFactory: () => client as never,
      },
    )
    expect(client.invite).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440008', { email: 'new@example.com', role: 'admin' })
  })
})
