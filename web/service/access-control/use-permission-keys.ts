import type { PermissionKeysResponse } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { get } from '../base'

const NAME_SPACE = 'workspace-permission-keys'

export const useWorkspacePermissionKeys = () => {
  return useQuery({
    queryKey: [NAME_SPACE],
    queryFn: () => get<PermissionKeysResponse>('/workspaces/current/rbac/my-permissions'),
  })
}
