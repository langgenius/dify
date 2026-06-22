import { renderHook } from '@testing-library/react'
import { useCredentialPermissions } from './use-credential-permissions'

let mockWorkspacePermissionKeys: string[] | null = []

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { workspacePermissionKeys: string[] | null }) => unknown) => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
}))

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

  it('should handle missing workspace permissions as no credential capabilities', () => {
    mockWorkspacePermissionKeys = null

    const { result } = renderHook(() => useCredentialPermissions())

    expect(result.current).toEqual({
      canUseCredential: false,
      canCreateCredential: false,
      canManageCredential: false,
    })
  })
})
