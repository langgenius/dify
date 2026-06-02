import type {
  AccessPolicy,
  AccessPolicyResourceType,
  AccessPolicyWithBindings,
  BindingsPayload,
  CreateAccessPolicyRequest,
  GetAppAccessPoliciesResponse,
  GetDatasetAccessPoliciesResponse,
  PaginationParameters,
  UpdateAccessPolicyRequest,
} from '@/models/access-control'
import type { CommonResponse } from '@/models/common'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { del, get, post, put } from '../base'

const NAME_SPACE = 'workspace-access-rules'

export const useInfiniteWorkspaceAppAccessRules = (params: PaginationParameters = {}) => {
  const { page = 1, ...queryParams } = params

  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'app', queryParams],
    queryFn: ({ pageParam }) => get<GetAppAccessPoliciesResponse>('/workspaces/current/rbac/workspace/apps/access-policy', {
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

export const useInfiniteWorkspaceDatasetAccessRules = (params: PaginationParameters = {}) => {
  const { page = 1, ...queryParams } = params

  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'dataset', queryParams],
    queryFn: ({ pageParam }) => get<GetDatasetAccessPoliciesResponse>('/workspaces/current/rbac/workspace/datasets/access-policy', {
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

export const useCreateAccessRule = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'create'],
    mutationFn: (data: CreateAccessPolicyRequest & { resourceType: AccessPolicyResourceType }) => {
      const { name, description, permission_keys, resourceType } = data
      return post<AccessPolicy>('/workspaces/current/rbac/access-policies', {
        body: {
          resource_type: resourceType,
          name,
          description,
          permission_keys,
        },
      })
    },
    onSuccess: (_, { resourceType }) => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, resourceType] })
    },
  })
}

export const useUpdateAccessRule = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (data: UpdateAccessPolicyRequest & { resourceType: AccessPolicyResourceType }) => {
      const { id, name, description, permission_keys } = data
      return put<AccessPolicy>(`/workspaces/current/rbac/access-policies/${id}`, {
        body: {
          id,
          name,
          description,
          permission_keys,
        },
      })
    },
    onSuccess: (_, { resourceType }) => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, resourceType] })
    },
  })
}

export const useCopyAccessRule = (resourceType: AccessPolicyResourceType) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'copy', resourceType],
    mutationFn: (id: string) => {
      return post<AccessPolicy>(`/workspaces/current/rbac/access-policies/${id}/copy`, {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, resourceType] })
    },
  })
}

export const useDeleteAccessRule = (resourceType: AccessPolicyResourceType) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'delete', resourceType],
    mutationFn: (id: string) => {
      return del<CommonResponse>(`/workspaces/current/rbac/access-policies/${id}`, {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, resourceType] })
    },
  })
}

export const useUpdateAppAccessRuleBindings = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-app-bindings'],
    mutationFn: (data: BindingsPayload & { id: string }) => {
      const { id, ...rest } = data
      return put<AccessPolicyWithBindings>(`/workspaces/current/rbac/workspace/apps/access-policies/${id}/bindings`, {
        body: {
          ...rest,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'app'] })
    },
  })
}

export const useUpdateDatasetAccessRuleBindings = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-dataset-bindings'],
    mutationFn: (data: BindingsPayload & { id: string }) => {
      const { id, ...rest } = data
      return put<AccessPolicyWithBindings>(`/workspaces/current/rbac/workspace/datasets/access-policies/${id}/bindings`, {
        body: {
          ...rest,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NAME_SPACE, 'dataset'] })
    },
  })
}
