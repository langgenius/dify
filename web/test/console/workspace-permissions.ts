import type { MyPermissionsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'

const currentWorkspacePermissionsQueryKey = [
  ['console', 'workspaces', 'current', 'rbac', 'myPermissions', 'get'],
  { type: 'query' },
] as const

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
  permissionKeys: readonly string[] = [],
) => {
  const data = createWorkspacePermissionsFixture(permissionKeys)
  queryClient.setQueryData(currentWorkspacePermissionsQueryKey, data)
  return data
}

export const ensureWorkspacePermissionsQuery = (
  queryClient: QueryClient,
  permissionKeys: readonly string[] = [],
) => {
  const existingPermissions = queryClient.getQueryData<MyPermissionsResponse>(
    currentWorkspacePermissionsQueryKey,
  )
  if (existingPermissions === undefined)
    return seedWorkspacePermissionsQuery(queryClient, permissionKeys)

  return existingPermissions
}
