import { del, get, patch, post, put } from './base'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FetchWorkflowDraftPageParams,
  FetchWorkflowDraftPageResponse,
  FetchWorkflowDraftResponse,
  NodeTracing,
  PublishWorkflowParams,
  UpdateWorkflowParams,
  VarInInspect,
  WorkflowConfigResponse,
} from '@/types/workflow'
import type { CommonResponse } from '@/models/common'
import { useInvalid, useReset } from './use-base'

const NAME_SPACE = 'workflow'

export const useAppWorkflow = (appID: string) => {
  return useQuery<FetchWorkflowDraftResponse>({
    enabled: !!appID,
    queryKey: [NAME_SPACE, 'publish', appID],
    queryFn: () => get<FetchWorkflowDraftResponse>(`/apps/${appID}/workflows/publish`),
  })
}

export const useInvalidateAppWorkflow = () => {
  const queryClient = useQueryClient()
  return (appID: string) => {
    queryClient.invalidateQueries(
      {
        queryKey: [NAME_SPACE, 'publish', appID],
      })
  }
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

const useLastRunKey = [NAME_SPACE, 'last-run']
export const useLastRun = (appID: string, nodeId: string, enabled: boolean) => {
  return useQuery<NodeTracing>({
    enabled,
    queryKey: [...useLastRunKey, appID, nodeId],
    queryFn: async () => {
      return get(`apps/${appID}/workflows/draft/nodes/${nodeId}/last-run`, {}, {
        silent: true,
      })
    },
    retry: 0,
  })
}

export const useInvalidLastRun = (appId: string, nodeId: string) => {
  return useInvalid([NAME_SPACE, 'last-run', appId, nodeId])
}

// Rerun workflow or change the version of workflow
export const useInvalidAllLastRun = (appId: string) => {
  return useInvalid([NAME_SPACE, 'last-run', appId])
}

const useConversationVarValuesKey = [NAME_SPACE, 'conversation-variable']

export const useConversationVarValues = (url?: string) => {
  return useQuery({
    enabled: !!url,
    queryKey: [...useConversationVarValuesKey, url],
    queryFn: async () => {
      const { items } = (await get(url || '')) as { items: VarInInspect[] }
      return items
    },
  })
}

export const useInvalidateConversationVarValues = (url: string) => {
  return useInvalid([...useConversationVarValuesKey, url])
}

export const useResetConversationVar = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'reset conversation var', appId],
    mutationFn: async (varId: string) => {
      return put(`apps/${appId}/workflows/draft/variables/${varId}/reset`)
    },
  })
}

export const useResetToLastRunValue = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'reset to last run value', appId],
    mutationFn: async (varId: string): Promise<{ value: any }> => {
      return put(`apps/${appId}/workflows/draft/variables/${varId}/reset`)
    },
  })
}

export const useSysVarValuesKey = [NAME_SPACE, 'sys-variable']
export const useSysVarValues = (url?: string) => {
  return useQuery({
    enabled: !!url,
    queryKey: [...useSysVarValuesKey, url],
    queryFn: async () => {
      const { items } = (await get(url || '')) as { items: VarInInspect[] }
      return items
    },
  })
}

export const useInvalidateSysVarValues = (url: string) => {
  return useInvalid([...useSysVarValuesKey, url])
}

export const useDeleteAllInspectorVars = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete all inspector vars', appId],
    mutationFn: async () => {
      return del(`apps/${appId}/workflows/draft/variables`)
    },
  })
}

export const useDeleteNodeInspectorVars = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete node inspector vars', appId],
    mutationFn: async (nodeId: string) => {
      return del(`apps/${appId}/workflows/draft/nodes/${nodeId}/variables`)
    },
  })
}

export const useDeleteInspectVar = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete inspector var', appId],
    mutationFn: async (varId: string) => {
      return del(`apps/${appId}/workflows/draft/variables/${varId}`)
    },
  })
}

// edit the name or value of the inspector var
export const useEditInspectorVar = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'edit inspector var', appId],
    mutationFn: async ({ varId, ...rest }: {
      varId: string
      name?: string
      value?: any
    }) => {
      return patch(`apps/${appId}/workflows/draft/variables/${varId}`, {
        body: rest,
      })
    },
  })
}
