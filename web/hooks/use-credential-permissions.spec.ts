import { renderHook } from '@/test/console/render'
import { useCredentialPermissions } from './use-credential-permissions'

let mockWorkspacePermissionKeys: string[] = []

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
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
