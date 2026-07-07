import type { PermissionKeysResponse } from '@/models/access-control'
import { queryOptions } from '@tanstack/react-query'
// eslint-disable-next-line no-restricted-imports
import { get } from '../base'

const NAME_SPACE = 'workspace-permission-keys'

const workspacePermissionKeysQueryKey = (workspaceId?: string) => {
  return workspaceId ? [NAME_SPACE, workspaceId] as const : [NAME_SPACE] as const
}

export const workspacePermissionKeysQueryOptions = (workspaceId?: string) => {
  return queryOptions<PermissionKeysResponse>({
    queryKey: workspacePermissionKeysQueryKey(workspaceId),
    queryFn: () => get<PermissionKeysResponse>('/workspaces/current/rbac/my-permissions'),
    enabled: workspaceId === undefined || Boolean(workspaceId),
  })
}
