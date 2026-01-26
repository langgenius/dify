import type { WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '@/app/components/tools/types'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { get, post } from '@/service/base'

const NAME_SPACE = 'workflow-tool'

// Query key factory for workflow tool detail
const workflowToolDetailKey = (appId: string) => [NAME_SPACE, 'detail', appId]

/**
 * Fetch workflow tool detail by app ID
 */
export const useWorkflowToolDetail = (appId: string, enabled = true) => {
  return useQuery<WorkflowToolProviderResponse>({
    queryKey: workflowToolDetailKey(appId),
    queryFn: () => get<WorkflowToolProviderResponse>(`/workspaces/current/tool-provider/workflow/detail?workflow_app_id=${appId}`),
    enabled: enabled && !!appId,
  })
}

/**
 * Invalidate workflow tool detail cache
 */
export const useInvalidateWorkflowToolDetail = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: workflowToolDetailKey(appId),
    })
  }
}

type CreateWorkflowToolPayload = WorkflowToolProviderRequest & { workflow_app_id: string }

/**
 * Create workflow tool provider mutation
 */
export const useCreateWorkflowTool = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create'],
    mutationFn: (payload: CreateWorkflowToolPayload) => {
      return post('/workspaces/current/tool-provider/workflow/create', {
        body: payload,
      })
    },
  })
}

type UpdateWorkflowToolPayload = WorkflowToolProviderRequest & Partial<{
  workflow_app_id: string
  workflow_tool_id: string
}>

/**
 * Update workflow tool provider mutation
 */
export const useUpdateWorkflowTool = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (payload: UpdateWorkflowToolPayload) => {
      return post('/workspaces/current/tool-provider/workflow/update', {
        body: payload,
      })
    },
  })
}
