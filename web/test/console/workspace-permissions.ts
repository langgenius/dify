import type { QueryClient } from '@tanstack/react-query'
import type { PermissionKeysResponse } from '@/models/access-control'
import { workspacePermissionKeysQueryOptions } from '@/service/access-control/use-permission-keys'

const createWorkspacePermissionsFixture = (
  permissionKeys: readonly string[] = [],
): PermissionKeysResponse => ({
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
  queryClient.setQueryData(workspacePermissionKeysQueryOptions(workspaceId).queryKey, data)
  return data
}

export const ensureWorkspacePermissionsQuery = (
  queryClient: QueryClient,
  workspaceId = 'workspace-1',
  permissionKeys: readonly string[] = [],
) => {
  const queryKey = workspacePermissionKeysQueryOptions(workspaceId).queryKey
  const existingPermissions = queryClient.getQueryData<PermissionKeysResponse>(queryKey)
  if (existingPermissions === undefined)
    return seedWorkspacePermissionsQuery(queryClient, workspaceId, permissionKeys)

  return existingPermissions
}
