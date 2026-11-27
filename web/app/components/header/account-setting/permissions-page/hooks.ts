import type { RoleListRequest } from '@/models/access-control'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { workspaceRoleListInfiniteOptions } from '../workspace-role-list-query'
import { formatRoleGroups } from './helpers'

export const useRoleGroups = (params: RoleListRequest) => {
  const roleListQuery = useInfiniteQuery(workspaceRoleListInfiniteOptions(params))
  const {
    data: roleList,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
    hasNextPage,
    error,
  } = roleListQuery

  const roleGroups = useMemo(() => formatRoleGroups(roleList), [roleList])

  return {
    roleGroups,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
    hasNextPage,
    error,
    /** For a caller that renders a failed first load: pass it to `useOwnedQueryError`. */
    query: roleListQuery,
  }
}
