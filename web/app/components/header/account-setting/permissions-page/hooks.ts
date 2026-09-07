import type { RoleListRequest } from '@/models/access-control'
import { useMemo } from 'react'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { formatRoleGroups } from './helpers'

export const useRoleGroups = (params: RoleListRequest) => {
  const {
    data: roleList,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
    hasNextPage,
    error,
  } = useWorkspaceRoleList(params)

  const roleGroups = useMemo(() => formatRoleGroups(roleList), [roleList])

  return {
    roleGroups,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
    hasNextPage,
    error,
  }
}
