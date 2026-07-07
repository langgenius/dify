'use client'

import type { PermissionKey } from '@/models/access-control'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import {
  currentWorkspaceAtom,
  currentWorkspaceLoadingAtom,
  systemFeaturesAtom,
  userProfileAtom,
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
  workspaceRoleFlagsAtom,
} from '@/context/app-context-state'
import { getDatasetACLCapabilities, hasPermission } from '@/utils/permission'

type DatasetAccessResource = {
  maintainer?: string | null
  permission_keys?: readonly PermissionKey[] | null
}

export const useDatasetRbacEnabled = () => {
  const systemFeatures = useAtomValue(systemFeaturesAtom)

  return systemFeatures.rbac_enabled
}

const useDatasetPermissionContext = () => {
  const currentUser = useAtomValue(userProfileAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return {
    currentUserId: currentUser.id,
    workspacePermissionKeys,
  }
}

export const useDatasetWorkspaceAccess = () => {
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const roleFlags = useAtomValue(workspaceRoleFlagsAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnectExternalDataset = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const canManageDatasetTags = hasPermission(workspacePermissionKeys, 'dataset.tag.manage')
  const canManageDatasetApiKeys = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')

  return {
    currentWorkspaceId: currentWorkspace.id,
    isCurrentWorkspaceOwner: roleFlags.isCurrentWorkspaceOwner,
    isLoadingCurrentWorkspace,
    isLoadingWorkspacePermissionKeys,
    isLoadingAccess: isLoadingCurrentWorkspace || !!isLoadingWorkspacePermissionKeys,
    workspacePermissionKeys,
    canCreateDataset,
    canConnectExternalDataset,
    canManageDatasetTags,
    canManageDatasetApiKeys,
  }
}

export const useDatasetCurrentUser = () => {
  return useAtomValue(userProfileAtom)
}

export const useDatasetACLCapabilities = (
  resource: DatasetAccessResource | null | undefined,
  options?: { isRbacEnabled?: boolean },
) => {
  const {
    currentUserId,
    workspacePermissionKeys,
  } = useDatasetPermissionContext()

  return useMemo(() => getDatasetACLCapabilities(resource?.permission_keys, {
    currentUserId,
    resourceMaintainer: resource?.maintainer,
    workspacePermissionKeys,
    isRbacEnabled: options?.isRbacEnabled,
  }), [currentUserId, options?.isRbacEnabled, resource?.maintainer, resource?.permission_keys, workspacePermissionKeys])
}
