import { renderHook } from '@testing-library/react'
import { useCredentialPermissions } from './use-credential-permissions'

let mockWorkspacePermissionKeys: string[] = []

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

describe('useCredentialPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = []
  })

  it('should expose separate use, create, and manage credential capabilities', () => {
    mockWorkspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage']

    const { result } = renderHook(() => useCredentialPermissions())

    expect(result.current).toEqual({
      canUseCredential: true,
      canCreateCredential: true,
      canManageCredential: true,
    })
  })

  it('should not grant credential use from create or manage permissions', () => {
    mockWorkspacePermissionKeys = ['credential.create', 'credential.manage']

    const { result } = renderHook(() => useCredentialPermissions())

    expect(result.current).toEqual({
      canUseCredential: false,
      canCreateCredential: true,
      canManageCredential: true,
    })
  })

  it('should handle empty workspace permissions as no credential capabilities', () => {
    mockWorkspacePermissionKeys = []

    const { result } = renderHook(() => useCredentialPermissions())

    expect(result.current).toEqual({
      canUseCredential: false,
      canCreateCredential: false,
      canManageCredential: false,
    })
  })
})
