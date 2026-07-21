import type { MyPermissionsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { workspacePermissionKeysQueryKey } from '@/context/permission-state'

const createWorkspacePermissionsFixture = (
  permissionKeys: readonly string[] = [],
): MyPermissionsResponse => ({
  workspace: {
    permission_keys: [...permissionKeys],
  },
  app: {
    default_permission_keys: [],
    overrides: [],
  },
  dataset: {
    default_permission_keys: [],
    overrides: [],
  },
})

export const seedWorkspacePermissionsQuery = (
  queryClient: QueryClient,
  workspaceId = 'workspace-1',
  permissionKeys: readonly string[] = [],
) => {
  const data = createWorkspacePermissionsFixture(permissionKeys)
  queryClient.setQueryData(workspacePermissionKeysQueryKey(workspaceId), data)
  return data
}

export const ensureWorkspacePermissionsQuery = (
  queryClient: QueryClient,
  workspaceId = 'workspace-1',
  permissionKeys: readonly string[] = [],
) => {
  const queryKey = workspacePermissionKeysQueryKey(workspaceId)
  const existingPermissions = queryClient.getQueryData<MyPermissionsResponse>(queryKey)
  if (existingPermissions === undefined)
    return seedWorkspacePermissionsQuery(queryClient, workspaceId, permissionKeys)

  return existingPermissions
}
