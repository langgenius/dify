import { del, get, patch, post } from './base'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type {
  FetchWorkflowDraftPageParams,
  FetchWorkflowDraftPageResponse,
  FetchWorkflowDraftResponse,
  PublishWorkflowParams,
  UpdateWorkflowParams,
  WorkflowConfigResponse,
} from '@/types/workflow'
import type { CommonResponse } from '@/models/common'
import { useReset } from './use-base'

const NAME_SPACE = 'workflow'

export const useAppWorkflow = (appID: string) => {
  return useQuery<FetchWorkflowDraftResponse>({
    enabled: !!appID,
    queryKey: [NAME_SPACE, 'publish', appID],
    queryFn: () => get<FetchWorkflowDraftResponse>(`/apps/${appID}/workflows/publish`),
  })
}

export const useWorkflowConfig = (appId: string, onSuccess: (v: WorkflowConfigResponse) => void) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'config', appId],
    queryFn: async () => {
      const data = await get<WorkflowConfigResponse>(`/apps/${appId}/workflows/draft/config`)
      onSuccess(data)
      return data
    },
  })
}

const WorkflowVersionHistoryKey = [NAME_SPACE, 'versionHistory']

export const useWorkflowVersionHistory = (params: FetchWorkflowDraftPageParams) => {
  const { appId, initialPage, limit, userId, namedOnly } = params
  return useInfiniteQuery({
    queryKey: [...WorkflowVersionHistoryKey, appId, initialPage, limit, userId, namedOnly],
    queryFn: ({ pageParam = 1 }) => get<FetchWorkflowDraftPageResponse>(`/apps/${appId}/workflows`, {
      params: {
        page: pageParam,
        limit,
        user_id: userId || '',
        named_only: !!namedOnly,
      },
    }),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : null,
    initialPageParam: initialPage,
  })
}

export const useResetWorkflowVersionHistory = (appId: string) => {
  return useReset([...WorkflowVersionHistoryKey, appId])
}

export const useUpdateWorkflow = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (params: UpdateWorkflowParams) => patch(`/apps/${appId}/workflows/${params.workflowId}`, {
      body: {
        marked_name: params.title,
        marked_comment: params.releaseNotes,
      },
    }),
  })
}

export const useDeleteWorkflow = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (workflowId: string) => del(`/apps/${appId}/workflows/${workflowId}`),
  })
}

export const usePublishWorkflow = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'publish'],
    mutationFn: (params: PublishWorkflowParams) => post<CommonResponse & { created_at: number }>(`/apps/${appId}/workflows/publish`, {
      body: {
        marked_name: params.title,
        marked_comment: params.releaseNotes,
      },
    }),
  })
}
