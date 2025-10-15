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
import type { FlowType } from '@/types/common'
import { getFlowPrefix } from './utils'

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

export const useWorkflowConfig = <T = WorkflowConfigResponse>(url: string, onSuccess: (v: T) => void) => {
  return useQuery({
    enabled: !!url,
    queryKey: [NAME_SPACE, 'config', url],
    staleTime: 0,
    queryFn: async () => {
      const data = await get<T>(url)
      onSuccess(data)
      return data
    },
  })
}

const WorkflowVersionHistoryKey = [NAME_SPACE, 'versionHistory']

export const useWorkflowVersionHistory = (params: FetchWorkflowDraftPageParams) => {
  const { url, initialPage, limit, userId, namedOnly } = params
  return useInfiniteQuery({
    enabled: !!url,
    queryKey: [...WorkflowVersionHistoryKey, url, initialPage, limit, userId, namedOnly],
    queryFn: ({ pageParam = 1 }) => get<FetchWorkflowDraftPageResponse>(url, {
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

export const useResetWorkflowVersionHistory = () => {
  return useReset([...WorkflowVersionHistoryKey])
}

export const useUpdateWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (params: UpdateWorkflowParams) => patch(params.url, {
      body: {
        marked_name: params.title,
        marked_comment: params.releaseNotes,
      },
    }),
  })
}

export const useDeleteWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (url: string) => del(url),
  })
}

export const usePublishWorkflow = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'publish'],
    mutationFn: (params: PublishWorkflowParams) => post<CommonResponse & { created_at: number }>(params.url, {
      body: {
        marked_name: params.title,
        marked_comment: params.releaseNotes,
      },
    }),
  })
}

const useLastRunKey = [NAME_SPACE, 'last-run']
export const useLastRun = (flowType: FlowType, flowId: string, nodeId: string, enabled: boolean) => {
  return useQuery<NodeTracing>({
    enabled,
    queryKey: [...useLastRunKey, flowType, flowId, nodeId],
    queryFn: async () => {
      return get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/last-run`, {}, {
        silent: true,
      })
    },
    retry: 0,
  })
}

export const useInvalidLastRun = (flowType: FlowType, flowId: string, nodeId: string) => {
  return useInvalid([...useLastRunKey, flowType, flowId, nodeId])
}

// Rerun workflow or change the version of workflow
export const useInvalidAllLastRun = (flowType?: FlowType, flowId?: string) => {
  return useInvalid([NAME_SPACE, flowType, 'last-run', flowId])
}

export const useConversationVarValues = (flowType?: FlowType, flowId?: string) => {
  return useQuery({
    enabled: !!flowId,
    queryKey: [NAME_SPACE, flowType, 'conversation var values', flowId],
    queryFn: async () => {
      const { items } = (await get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/conversation-variables`)) as { items: VarInInspect[] }
      return items
    },
  })
}

export const useInvalidateConversationVarValues = (flowType: FlowType, flowId: string) => {
  return useInvalid([NAME_SPACE, flowType, 'conversation var values', flowId])
}

export const useResetConversationVar = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'reset conversation var', flowId],
    mutationFn: async (varId: string) => {
      return put(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}/reset`)
    },
  })
}

export const useResetToLastRunValue = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'reset to last run value', flowId],
    mutationFn: async (varId: string): Promise<{ value: any }> => {
      return put(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}/reset`)
    },
  })
}

export const useSysVarValuesKey = [NAME_SPACE, 'sys-variable']
export const useSysVarValues = (flowType?: FlowType, flowId?: string) => {
  return useQuery({
    enabled: !!flowId,
    queryKey: [NAME_SPACE, flowType, 'sys var values', flowId],
    queryFn: async () => {
      const { items } = (await get(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/system-variables`)) as { items: VarInInspect[] }
      return items
    },
  })
}

export const useInvalidateSysVarValues = (flowType: FlowType, flowId: string) => {
  return useInvalid([NAME_SPACE, flowType, 'sys var values', flowId])
}

export const useDeleteAllInspectorVars = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'delete all inspector vars', flowId],
    mutationFn: async () => {
      return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables`)
    },
  })
}

export const useDeleteNodeInspectorVars = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'delete node inspector vars', flowId],
    mutationFn: async (nodeId: string) => {
      return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/nodes/${nodeId}/variables`)
    },
  })
}

export const useDeleteInspectVar = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'delete inspector var', flowId],
    mutationFn: async (varId: string) => {
      return del(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}`)
    },
  })
}

// edit the name or value of the inspector var
export const useEditInspectorVar = (flowType: FlowType, flowId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, flowType, 'edit inspector var', flowId],
    mutationFn: async ({ varId, ...rest }: {
      varId: string
      name?: string
      value?: any
    }) => {
      return patch(`${getFlowPrefix(flowType)}/${flowId}/workflows/draft/variables/${varId}`, {
        body: rest,
      })
    },
  })
}
