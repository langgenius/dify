'use client'

import type { PermissionKey } from '@/models/access-control'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getDatasetACLCapabilities, hasPermission } from '@/utils/permission'

type DatasetAccessResource = {
  maintainer?: string | null
  permission_keys?: readonly PermissionKey[] | null
}

export const useDatasetRbacEnabled = () => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return systemFeatures.rbac_enabled
}

const useDatasetPermissionContext = () => {
  const currentUserId = useAppContextSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys ?? [])

  return {
    currentUserId,
    workspacePermissionKeys,
  }
}

export const useDatasetWorkspaceAccess = () => {
  const currentWorkspaceId = useAppContextSelector(state => state.currentWorkspace?.id ?? '')
  const isCurrentWorkspaceOwner = useAppContextSelector(state => state.isCurrentWorkspaceOwner ?? false)
  const isLoadingCurrentWorkspace = useAppContextSelector(state => state.isLoadingCurrentWorkspace ?? false)
  const isLoadingWorkspacePermissionKeys = useAppContextSelector(state => state.isLoadingWorkspacePermissionKeys ?? false)
  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys ?? [])

  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnectExternalDataset = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const canManageDatasetTags = hasPermission(workspacePermissionKeys, 'dataset.tag.manage')
  const canManageDatasetApiKeys = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')

  return {
    currentWorkspaceId,
    isCurrentWorkspaceOwner,
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
  return useAppContextSelector(state => state.userProfile)
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
