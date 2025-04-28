import { del, get, patch, post } from './base'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type {
  FetchWorkflowDraftPageParams,
  FetchWorkflowDraftPageResponse,
  FetchWorkflowDraftResponse,
  NodeTracing,
  PublishWorkflowParams,
  UpdateWorkflowParams,
  WorkflowConfigResponse,
} from '@/types/workflow'
import type { CommonResponse } from '@/models/common'
import { useInvalid, useReset } from './use-base'
import { sleep } from '@/utils'
import { conversationVars, systemVars } from '@/app/components/workflow/store/workflow/debug/mock-data'

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

const useLastRunKey = [NAME_SPACE, 'last-run']
export const useLastRun = (appID: string, nodeId: string, enabled: boolean) => {
  return useQuery<NodeTracing>({
    enabled,
    queryKey: [...useLastRunKey, appID, nodeId],
    queryFn: async () => {
      console.log(`fetch last run : ${nodeId}`)
      // TODO: mock data
      await sleep(1000)
      return Promise.resolve({
        node_id: nodeId,
        status: 'success',
        node_type: 'llm',
        title: 'LLM',
        inputs: null,
        outputs: {
          text: '"abc" is a simple sequence of three letters.  Is there anything specific you\'d like to know about it, or are you just testing the system? \n\nLet me know if you have any other questions or tasks! 😊 \n',
          usage: {
            prompt_tokens: 3,
            prompt_unit_price: '0',
            prompt_price_unit: '0.000001',
            prompt_price: '0',
            completion_tokens: 48,
            completion_unit_price: '0',
            completion_price_unit: '0.000001',
            completion_price: '0',
            total_tokens: 51,
            total_price: '0',
            currency: 'USD',
            latency: 0.7095853444188833,
          },
          finish_reason: '1',
        },
      } as any)
    },
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

export const useConversationVarValues = (appId: string) => {
  let index = 1
  return useQuery({
    queryKey: [...useConversationVarValuesKey, appId],
    queryFn: async () => {
      await sleep(1000)
      return Promise.resolve(conversationVars.map((item) => {
        return {
          ...item,
          value: `${item.value}${index++}`,
        }
      }))
    },
  })
}

export const useInvalidateConversationVarValues = (appId: string) => {
  return useInvalid([...useConversationVarValuesKey, appId])
}

export const useSysVarValuesKey = [NAME_SPACE, 'sys-variable']
export const useSysVarValues = (appId: string) => {
  let index = 1

  return useQuery({
    queryKey: [...useSysVarValuesKey, appId],
    queryFn: async () => {
      await sleep(1000)
      return Promise.resolve(systemVars.map((item) => {
        return {
          ...item,
          value: `${item.value}${index++}`,
        }
      }))
    },
  })
}

export const useInvalidateSysVarValues = (appId: string) => {
  return useInvalid([...useSysVarValuesKey, appId])
}

export const useDeleteAllInspectorVars = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete all inspector vars', appId],
    mutationFn: async () => {
      console.log('remove all inspector vars')
    },
  })
}

export const useDeleteNodeInspectorVars = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete node inspector vars', appId],
    mutationFn: async (nodeId: string) => {
      console.log('remove node inspector vars', nodeId)
    },
  })
}

export const useDeleteInspectVar = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete inspector var', appId],
    mutationFn: async (varId: string) => {
      console.log('remove inspector var', varId)
    },
  })
}

// edit the name or value of the inspector var
export const useEditInspectorVar = (appId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'edit inspector var', appId],
    mutationFn: async (params: {
      nodeId: string
      varId: string
      name?: string
      value?: any
    }) => {
      console.log('edit inspector var', params)
    },
  })
}
