'use client'

import type { PermissionKey } from '@/models/access-control'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import {
  userProfileAtom,
  workspacePermissionKeysAtom,
} from '@/context/app-context-state'
import { getDatasetACLCapabilities } from '@/utils/permission'

type DatasetAccessResource = {
  maintainer?: string | null
  permission_keys?: readonly PermissionKey[] | null
}

export const useDatasetACLCapabilities = (
  resource: DatasetAccessResource | null | undefined,
  options?: { isRbacEnabled?: boolean },
) => {
  const currentUser = useAtomValue(userProfileAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return useMemo(() => getDatasetACLCapabilities(resource?.permission_keys, {
    currentUserId: currentUser.id,
    resourceMaintainer: resource?.maintainer,
    workspacePermissionKeys,
    isRbacEnabled: options?.isRbacEnabled,
  }), [currentUser.id, options?.isRbacEnabled, resource?.maintainer, resource?.permission_keys, workspacePermissionKeys])
}
