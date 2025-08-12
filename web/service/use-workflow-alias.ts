import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, patch, post } from './base'
import type { WorkflowAlias, WorkflowAliasList } from '@/app/components/workflow/types'

export const useWorkflowAliasList = ({ appId, workflowId }: {
  appId: string
  workflowId: string
}) => {
  return useQuery<WorkflowAliasList>({
    queryKey: ['workflow-aliases', appId, workflowId],
    queryFn: async () => {
      return get<WorkflowAliasList>(`/apps/${appId}/workflows/${workflowId}/aliases`)
    },
    enabled: !!appId && !!workflowId,
  })
}

export const useCreateWorkflowAlias = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      workflow_id: string
      alias_name: string
      alias_type: 'system' | 'custom'
    }) => {
      return post<WorkflowAlias>(`/apps/${appId}/workflow-aliases`, {
        body: data,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-aliases', appId] })
    },
  })
}

export const useUpdateWorkflowAlias = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ aliasId, data }: {
      aliasId: string
      data: {
        alias_name?: string
      }
    }) => {
      return patch<WorkflowAlias>(`/apps/${appId}/workflow-aliases/${aliasId}`, {
        body: data,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-aliases', appId] })
    },
  })
}

export const useDeleteWorkflowAlias = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (aliasId: string) => {
      return del(`/apps/${appId}/workflow-aliases/${aliasId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-aliases', appId] })
    },
  })
}

export const useWorkflowAliasDetail = ({ appId, aliasId }: { appId: string; aliasId: string }) => {
  return useQuery<WorkflowAlias>({
    queryKey: ['workflow-alias-detail', appId, aliasId],
    queryFn: async () => {
      return get<WorkflowAlias>(`/apps/${appId}/workflow-aliases/${aliasId}`)
    },
    enabled: !!appId && !!aliasId,
  })
}
