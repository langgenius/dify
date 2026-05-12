import type {
  CreateRoleRequest,
  Role,
  RoleListRequest,
  RoleListResponse,
} from '@/models/access-control'
import type { CommonResponse } from '@/models/common'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post, put } from '../base'

const NAME_SPACE = 'rbac-role-management'

export const useWorkspaceRoleList = (params: RoleListRequest) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'workspace-role-list', params],
    queryFn: () => get<RoleListResponse>('/workspaces/current/rbac/roles', { params }),
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
