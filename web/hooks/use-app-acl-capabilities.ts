import type { PermissionKey } from '@/models/access-control'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { getAppACLCapabilities } from '@/utils/permission'

export function useAppACLCapabilities(
  permissionKeys: readonly PermissionKey[] | null | undefined,
  resourceMaintainer: string | null | undefined,
) {
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return useMemo(
    () =>
      getAppACLCapabilities(permissionKeys, {
        currentUserId,
        resourceMaintainer: resourceMaintainer ?? undefined,
        workspacePermissionKeys,
      }),
    [permissionKeys, resourceMaintainer, currentUserId, workspacePermissionKeys],
  )
}
