import { get } from './base'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { FetchWorkflowDraftPageResponse, FetchWorkflowDraftResponse, WorkflowConfigResponse } from '@/types/workflow'

const NAME_SPACE = 'workflow'

export const useAppWorkflow = (appID: string) => {
  return useQuery<FetchWorkflowDraftResponse>({
    enabled: !!appID,
    queryKey: [NAME_SPACE, 'publish', appID],
    queryFn: () => get<FetchWorkflowDraftResponse>(`/apps/${appID}/workflows/publish`),
  })
}

export const useWorkflowConfig = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'config', appId],
    queryFn: () => get<WorkflowConfigResponse>(`/apps/${appId}/workflows/draft/config`),
  })
}

export const useWorkflowVersionHistory = (appId: string, initialPage: number, limit: number) => {
  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'versionHistory', appId, initialPage, limit],
    queryFn: ({ pageParam = 1 }) => get<FetchWorkflowDraftPageResponse>(`/apps/${appId}/workflows?page=${pageParam}&limit=${limit}`),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : null,
    initialPageParam: initialPage,
  })
}
