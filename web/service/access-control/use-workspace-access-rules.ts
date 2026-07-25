import type {
  AccessPolicy,
  AccessPolicyResourceType,
  CreateAccessPolicyRequest,
  GetAppAccessPoliciesResponse,
  GetDatasetAccessPoliciesResponse,
  UpdateAccessPolicyRequest,
  WorkspaceAccessRulesRequest,
} from '@/models/access-control'
import type { CommonResponse } from '@/models/common'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { del, get, post, put } from '../base'

const NAME_SPACE = 'workspace-access-rules'

type WorkspaceAccessRulesQueryParams = Omit<WorkspaceAccessRulesRequest, 'page'>

const workspaceAccessRulesQueryKeys = {
  app: (params?: WorkspaceAccessRulesQueryParams) =>
    params ? ([NAME_SPACE, 'app', params] as const) : ([NAME_SPACE, 'app'] as const),
  dataset: (params?: WorkspaceAccessRulesQueryParams) =>
    params ? ([NAME_SPACE, 'dataset', params] as const) : ([NAME_SPACE, 'dataset'] as const),
}

export const useInfiniteWorkspaceAppAccessRules = (params: WorkspaceAccessRulesRequest = {}) => {
  const { page = 1, ...queryParams } = params

  return useInfiniteQuery({
    queryKey: workspaceAccessRulesQueryKeys.app(queryParams),
    queryFn: ({ pageParam }) =>
      get<GetAppAccessPoliciesResponse>('/workspaces/current/rbac/workspace/apps/access-policy', {
        params: {
          ...queryParams,
          page: pageParam,
        },
      }),
    initialPageParam: page,
    getNextPageParam: (lastPage) => {
      const { current_page, total_pages } = lastPage.pagination

      if (current_page < total_pages) return current_page + 1

      return undefined
    },
  })
}

export const useInfiniteWorkspaceDatasetAccessRules = (
  params: WorkspaceAccessRulesRequest = {},
) => {
  const { page = 1, ...queryParams } = params

  return useInfiniteQuery({
    queryKey: workspaceAccessRulesQueryKeys.dataset(queryParams),
    queryFn: ({ pageParam }) =>
      get<GetDatasetAccessPoliciesResponse>(
        '/workspaces/current/rbac/workspace/datasets/access-policy',
        {
          params: {
            ...queryParams,
            page: pageParam,
          },
        },
      ),
    initialPageParam: page,
    getNextPageParam: (lastPage) => {
      const { current_page, total_pages } = lastPage.pagination

      if (current_page < total_pages) return current_page + 1

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
      queryClient.invalidateQueries({
        queryKey:
          resourceType === 'app'
            ? workspaceAccessRulesQueryKeys.app()
            : workspaceAccessRulesQueryKeys.dataset(),
      })
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
      queryClient.invalidateQueries({
        queryKey:
          resourceType === 'app'
            ? workspaceAccessRulesQueryKeys.app()
            : workspaceAccessRulesQueryKeys.dataset(),
      })
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
      queryClient.invalidateQueries({
        queryKey:
          resourceType === 'app'
            ? workspaceAccessRulesQueryKeys.app()
            : workspaceAccessRulesQueryKeys.dataset(),
      })
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
      queryClient.invalidateQueries({
        queryKey:
          resourceType === 'app'
            ? workspaceAccessRulesQueryKeys.app()
            : workspaceAccessRulesQueryKeys.dataset(),
      })
    },
  })
}
