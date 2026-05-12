import type { RoleListRequest } from '@/models/access-control'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { formatRoleGroups } from './helpers'

export const useRoleGroups = (params: RoleListRequest) => {
  const { data: roleList, isLoading } = useWorkspaceRoleList(params)

  const roleGroups = formatRoleGroups(roleList)

  return {
    roleGroups,
    isLoading,
  }
}
