import type {
  CreateRoleRequest,
  Role,
  RoleListRequest,
  RoleListResponse,
} from '@/models/access-control'
import type { CommonResponse } from '@/models/common'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { del, get, post, put } from '../base'

const NAME_SPACE = 'rbac-role-management'

export const useWorkspaceRoleList = (params: RoleListRequest) => {
  const { page = 1, ...queryParams } = params

  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'workspace-role-list', queryParams],
    queryFn: ({ pageParam }) => get<RoleListResponse>('/workspaces/current/rbac/roles', {
      params: {
        ...queryParams,
        page: pageParam,
      },
    }),
    initialPageParam: page,
    getNextPageParam: (lastPage) => {
      const { current_page, total_pages } = lastPage.pagination

      if (current_page < total_pages)
        return current_page + 1

      return undefined
    },
  })
}

export const useCreateWorkspaceRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'create-workspace-role'],
    mutationFn: (data: CreateRoleRequest) =>
      post<Role>('/workspaces/current/rbac/roles', {
        body: { ...data },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'workspace-role-list'] })
    },
  })
}

export const useUpdateWorkspaceRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-workspace-role'],
    mutationFn: (data: CreateRoleRequest & { id: string }) =>
      put<Role>(`/workspaces/current/rbac/roles/${data.id}`, {
        body: { ...data },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'workspace-role-list'] })
    },
  })
}

export const useDeleteWorkspaceRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'delete-workspace-role'],
    mutationFn: (id: string) =>
      del<CommonResponse>(`/workspaces/current/rbac/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'workspace-role-list'] })
    },
  })
}

export const useCopyWorkspaceRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'copy-workspace-role'],
    mutationFn: (id: string) =>
      post<Role>(`/workspaces/current/rbac/roles/${id}/copy`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'workspace-role-list'] })
    },
  })
}
