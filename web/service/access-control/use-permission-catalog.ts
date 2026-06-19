import type {
  PermissionGroups,
} from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { get } from '../base'

const NAME_SPACE = 'rbac-permission-catalog'

export const useWorkspacePermissionCatalog = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'workspace'],
    queryFn: () => get<PermissionGroups>('/workspaces/current/rbac/role-permissions/catalog'),
  })
}

export const useAppPermissionCatalog = (enabled?: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app'],
    queryFn: () => get<PermissionGroups>('/workspaces/current/rbac/role-permissions/catalog/app'),
    enabled: enabled ?? true,
  })
}

export const useDatasetPermissionCatalog = (enabled?: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'dataset'],
    queryFn: () => get<PermissionGroups>('/workspaces/current/rbac/role-permissions/catalog/dataset'),
    enabled: enabled ?? true,
  })
}
