import type { ActiveContext } from '@/auth/hosts'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceId } from './resolver'

function active(workspaceId?: string): ActiveContext {
  return {
    host: 'h',
    email: 'e',
    ctx: {
      account: { id: '', email: 'e', name: '' },
      workspace: workspaceId ? { id: workspaceId, name: 'W', role: 'owner' } : undefined,
    },
  }
}

const UUID_FLAG = 'aaaaaaaa-0000-0000-0000-000000000001'
const UUID_ENV = 'aaaaaaaa-0000-0000-0000-000000000002'
const UUID_CTX = 'aaaaaaaa-0000-0000-0000-000000000003'

describe('resolveWorkspaceId', () => {
  it('prefers the flag', () => {
    expect(resolveWorkspaceId({ flag: UUID_FLAG, env: UUID_ENV, active: active(UUID_CTX) })).toBe(
      UUID_FLAG,
    )
  })
  it('falls back to env over active workspace', () => {
    expect(resolveWorkspaceId({ env: UUID_ENV, active: active(UUID_CTX) })).toBe(UUID_ENV)
  })
  it('falls back to active workspace when no flag or env', () => {
    expect(resolveWorkspaceId({ active: active(UUID_CTX) })).toBe(UUID_CTX)
  })
  it('throws when active workspace ID is not a valid UUID', () => {
    expect(() => resolveWorkspaceId({ active: active('ws-ctx') })).toThrow(/stored workspace ID/)
  })
  it('throws when no workspace is selected (no implicit default)', () => {
    expect(() => resolveWorkspaceId({ active: active(undefined) })).toThrow(/no workspace selected/)
  })
})
