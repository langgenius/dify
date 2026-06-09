import type { ActiveContext } from '@/auth/hosts'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceId } from './resolver'

function active(workspaceId?: string): ActiveContext {
  return { host: 'h', email: 'e', ctx: { account: { id: '', email: 'e', name: '' }, workspace: workspaceId ? { id: workspaceId, name: 'W', role: 'owner' } : undefined } }
}

describe('resolveWorkspaceId', () => {
  it('prefers the flag', () => {
    expect(resolveWorkspaceId({ flag: 'ws-flag', env: 'ws-env', active: active('ws-ctx') })).toBe('ws-flag')
  })
  it('falls back to env then active workspace', () => {
    expect(resolveWorkspaceId({ env: 'ws-env', active: active('ws-ctx') })).toBe('ws-env')
    expect(resolveWorkspaceId({ active: active('ws-ctx') })).toBe('ws-ctx')
  })
  it('throws when no workspace is selected (no implicit default)', () => {
    expect(() => resolveWorkspaceId({ active: active(undefined) })).toThrow(/no workspace selected/)
  })
})
