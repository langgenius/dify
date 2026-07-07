import { renderHook } from '@testing-library/react'
import {
  currentWorkspaceAtom,
  currentWorkspaceLoadingAtom,
  systemFeaturesAtom,
  userProfileAtom,
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
  workspaceRoleFlagsAtom,
} from '@/context/app-context-state'
import { DatasetACLPermission } from '@/utils/permission'
import {
  useDatasetACLCapabilities,
  useDatasetCurrentUser,
  useDatasetRbacEnabled,
  useDatasetWorkspaceAccess,
} from '../use-dataset-access'

const mockAtomValues = vi.hoisted(() => new Map<unknown, unknown>())

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()

  return {
    ...actual,
    useAtomValue: (atom: unknown) => mockAtomValues.get(atom),
  }
})

const setDatasetAccessAtomValues = () => {
  mockAtomValues.clear()
  mockAtomValues.set(systemFeaturesAtom, { rbac_enabled: true })
  mockAtomValues.set(userProfileAtom, {
    id: 'user-1',
    name: 'User 1',
    email: 'user1@example.com',
  })
  mockAtomValues.set(currentWorkspaceAtom, { id: 'workspace-1' })
  mockAtomValues.set(workspaceRoleFlagsAtom, { isCurrentWorkspaceOwner: true })
  mockAtomValues.set(currentWorkspaceLoadingAtom, false)
  mockAtomValues.set(workspacePermissionKeysLoadingAtom, false)
  mockAtomValues.set(workspacePermissionKeysAtom, [
    'dataset.create_and_management',
    'dataset.external.connect',
    'dataset.tag.manage',
    'dataset.api_key.manage',
  ])
}

describe('useDatasetAccess hooks', () => {
  beforeEach(() => {
    setDatasetAccessAtomValues()
  })

  it('should read RBAC status from the system features atom', () => {
    mockAtomValues.set(systemFeaturesAtom, { rbac_enabled: false })

    const { result } = renderHook(() => useDatasetRbacEnabled())

    expect(result.current).toBe(false)
  })

  it('should expose workspace access derived from state atoms', () => {
    mockAtomValues.set(workspacePermissionKeysLoadingAtom, true)

    const { result } = renderHook(() => useDatasetWorkspaceAccess())

    expect(result.current).toMatchObject({
      currentWorkspaceId: 'workspace-1',
      isCurrentWorkspaceOwner: true,
      isLoadingCurrentWorkspace: false,
      isLoadingWorkspacePermissionKeys: true,
      isLoadingAccess: true,
      canCreateDataset: true,
      canConnectExternalDataset: true,
      canManageDatasetTags: true,
      canManageDatasetApiKeys: true,
    })
  })

  it('should expose the current user from the user profile atom', () => {
    const { result } = renderHook(() => useDatasetCurrentUser())

    expect(result.current).toMatchObject({
      id: 'user-1',
      email: 'user1@example.com',
    })
  })

  it('should compute dataset ACL capabilities with current user and workspace permissions', () => {
    const { result } = renderHook(() => useDatasetACLCapabilities({
      maintainer: 'user-1',
      permission_keys: [DatasetACLPermission.Readonly],
    }, {
      isRbacEnabled: true,
    }))

    expect(result.current.canReadonly).toBe(true)
    expect(result.current.canEdit).toBe(true)
    expect(result.current.canAccessConfig).toBe(true)
  })
})
