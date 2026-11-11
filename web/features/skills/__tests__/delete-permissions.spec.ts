import { act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { renderHookWithConsoleQuery, seedSystemFeatures } from '@/test/console/query-data'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { useSkillPermissions } from '../permissions'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.profile.get': () => new Promise<never>(() => {}),
    }),
  }
})

describe('Skill creator deletion', () => {
  it.each([
    { rbac: true, keys: ['skill.edit'], self: true, other: false },
    { rbac: true, keys: ['skill.view'], self: true, other: false },
    { rbac: true, keys: [], self: true, other: false },
    { rbac: true, keys: ['skill.delete'], self: true, other: true },
    { rbac: false, keys: ['skill.edit'], self: false, other: false },
    { rbac: false, keys: ['skill.delete'], self: true, other: true },
  ])('evaluates creator access for RBAC=$rbac and $keys', ({ rbac, keys, self, other }) => {
    const { result } = renderHookWithConsoleQuery(useSkillPermissions, {
      accountProfile: { id: 'alice' },
      systemFeatures: { rbac_enabled: rbac },
      workspacePermissionKeys: keys,
    })
    expect(result.current.canDeleteSkill('alice')).toBe(self)
    expect(result.current.canDeleteSkill('bob')).toBe(other)
    expect(result.current.canDeleteSkill(null)).toBe(other)
    expect(result.current.canDeleteSkill(undefined)).toBe(other)
  })

  it('does not infer creator access before the current account is loaded', () => {
    const { result } = renderHookWithConsoleQuery(useSkillPermissions, {
      accountProfile: null,
      systemFeatures: { rbac_enabled: true },
      workspacePermissionKeys: ['skill.view'],
    })
    expect(result.current.canDeleteSkill('alice')).toBe(false)
  })

  it('keeps creator deletion after edit is revoked and follows account and RBAC changes', async () => {
    const { result, queryClient } = renderHookWithConsoleQuery(useSkillPermissions, {
      accountProfile: { id: 'alice' },
      systemFeatures: { rbac_enabled: true },
      workspacePermissionKeys: ['skill.edit'],
    })
    expect(result.current.canDeleteSkill('alice')).toBe(true)
    await act(async () => {
      seedWorkspacePermissionsQuery(queryClient, ['skill.view'])
    })
    await waitFor(() => expect(result.current.canEdit).toBe(false))
    expect(result.current.canDeleteSkill('alice')).toBe(true)
    expect(result.current.canDeleteSkill('bob')).toBe(false)
    await act(async () => {
      seedAccountProfileQuery(queryClient, { id: 'bob' })
    })
    await waitFor(() => expect(result.current.canDeleteSkill('alice')).toBe(false))
    expect(result.current.canDeleteSkill('bob')).toBe(true)
    await act(async () => {
      seedAccountProfileQuery(queryClient, { id: 'alice' })
    })
    await waitFor(() => expect(result.current.canDeleteSkill('alice')).toBe(true))
    await act(async () => {
      seedSystemFeatures(queryClient, { rbac_enabled: false })
    })
    await waitFor(() => expect(result.current.canDeleteSkill('alice')).toBe(false))
  })
})
