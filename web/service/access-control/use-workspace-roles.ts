import type {
  CopyWorkspaceRoleRequest,
  CreateRoleRequest,
  GetMembersOfRoleRequest,
  GetMembersOfRoleResponse,
  Role,
  RoleListRequest,
  RoleListResponse,
  UpdateRolesRequest,
} from '@/models/access-control'
import type { CommonResponse } from '@/models/common'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post, put } from '../base'
import { commonQueryKeys } from '../use-common'

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
    mutationFn: (data: UpdateRolesRequest) =>
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
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'workspace-role-list'] }),
      queryClient.invalidateQueries({ queryKey: commonQueryKeys.members }),
    ]),
  })
}

export const useCopyWorkspaceRole = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'copy-workspace-role'],
    mutationFn: ({ roleId, copy_member }: CopyWorkspaceRoleRequest) =>
      post<Role>(`/workspaces/current/rbac/roles/${roleId}/copy`, {
        body: { copy_member },
      }),
    onSuccess: (_role, variables) => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'workspace-role-list'] }),
      ]

      if (variables.copy_member)
        invalidations.push(queryClient.invalidateQueries({ queryKey: commonQueryKeys.members }))

      return Promise.all(invalidations)
    },
  })
}

export const useGetMembersOfRole = (params: GetMembersOfRoleRequest) => {
  const { roleId, ...paginationParams } = params
  return useQuery({
    queryKey: [NAME_SPACE, 'members-of-role', roleId, paginationParams],
    queryFn: () => get<GetMembersOfRoleResponse>(`/workspaces/current/rbac/roles/${roleId}/members`, {
      params: {
        ...paginationParams,
      },
    }),
    enabled: !!roleId,
  })
}
