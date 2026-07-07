import type { PermissionKey } from '@/models/access-control'
import { getDatasetACLCapabilities, hasPermission } from '@/utils/permission'

type DatasetAccessMockState = {
  userProfile?: {
    id?: string
    name?: string
    email?: string
    avatar?: string
    avatar_url?: string
    is_password_set?: boolean
  } | null
  currentWorkspace?: {
    id?: string
  } | null
  isCurrentWorkspaceOwner?: boolean
  isLoadingCurrentWorkspace?: boolean
  isLoadingWorkspacePermissionKeys?: boolean
  workspacePermissionKeys?: string[]
}

type DatasetAccessMockOptions = {
  isRbacEnabled?: boolean
}

type DatasetAccessResource = {
  maintainer?: string | null
  permission_keys?: readonly PermissionKey[] | null
}

const defaultUserProfile = {
  id: 'user-1',
  name: 'User',
  email: 'user@example.com',
  avatar: '',
  avatar_url: '',
  is_password_set: true,
}

export const createDatasetAccessHookMock = (
  getState: () => DatasetAccessMockState,
  getOptions: () => DatasetAccessMockOptions = () => ({}),
) => {
  const getUserProfile = () => ({
    ...defaultUserProfile,
    ...getState().userProfile,
  })

  const getWorkspacePermissionKeys = () => getState().workspacePermissionKeys ?? []

  return {
    useDatasetRbacEnabled: () => getOptions().isRbacEnabled ?? true,
    useDatasetCurrentUser: getUserProfile,
    useDatasetWorkspaceAccess: () => {
      const state = getState()
      const workspacePermissionKeys = getWorkspacePermissionKeys()
      const isLoadingCurrentWorkspace = state.isLoadingCurrentWorkspace ?? false
      const isLoadingWorkspacePermissionKeys = state.isLoadingWorkspacePermissionKeys ?? false

      return {
        currentWorkspaceId: state.currentWorkspace?.id ?? 'workspace-1',
        isCurrentWorkspaceOwner: state.isCurrentWorkspaceOwner ?? false,
        isLoadingCurrentWorkspace,
        isLoadingWorkspacePermissionKeys,
        isLoadingAccess: isLoadingCurrentWorkspace || isLoadingWorkspacePermissionKeys,
        workspacePermissionKeys,
        canCreateDataset: hasPermission(workspacePermissionKeys, 'dataset.create_and_management'),
        canConnectExternalDataset: hasPermission(workspacePermissionKeys, 'dataset.external.connect'),
        canManageDatasetTags: hasPermission(workspacePermissionKeys, 'dataset.tag.manage'),
        canManageDatasetApiKeys: hasPermission(workspacePermissionKeys, 'dataset.api_key.manage'),
      }
    },
    useDatasetACLCapabilities: (
      resource: DatasetAccessResource | null | undefined,
      options?: { isRbacEnabled?: boolean },
    ) => getDatasetACLCapabilities(resource?.permission_keys, {
      currentUserId: getUserProfile().id,
      resourceMaintainer: resource?.maintainer,
      workspacePermissionKeys: getWorkspacePermissionKeys(),
      isRbacEnabled: options?.isRbacEnabled,
    }),
  }
}
