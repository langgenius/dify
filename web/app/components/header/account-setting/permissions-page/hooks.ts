import type { RoleListRequest } from '@/models/access-control'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { workspaceRoleListInfiniteOptions } from '../workspace-role-list-query'
import { formatRoleGroups } from './helpers'

export const useRoleGroups = (params: RoleListRequest) => {
  const {
    data: roleList,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
    hasNextPage,
    error,
  } = useInfiniteQuery(workspaceRoleListInfiniteOptions(params))

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
