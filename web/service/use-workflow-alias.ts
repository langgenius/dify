import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post } from './base'
import type { WorkflowAlias, WorkflowAliasList } from '@/app/components/workflow/types'

export const useWorkflowAliasList = ({ appId, workflowIds }: {
  appId: string
  workflowIds?: string[]
}) => {
  return useQuery<WorkflowAliasList>({
    queryKey: ['workflow-aliases', appId, workflowIds],
    queryFn: async () => {
      if (workflowIds && workflowIds.length > 0) {
        const workflowIdsParam = workflowIds.join(',')
        return get<WorkflowAliasList>(`/apps/${appId}/workflow-aliases?workflow_ids=${workflowIdsParam}`)
      }
 else {
        // When no workflow IDs, get all aliases for the app
        return get<WorkflowAliasList>(`/apps/${appId}/workflow-aliases`)
      }
    },
    enabled: !!appId && (workflowIds === undefined || workflowIds.length > 0),
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
    onSuccess: (data) => {
      // Instead of invalidating all queries, update the specific cache
      // This prevents multiple network requests
      queryClient.setQueriesData(
        {
          queryKey: ['workflow-aliases', appId],
          exact: false,
        },
        (oldData: WorkflowAliasList | undefined) => {
          if (!oldData) return oldData

          // Add the new alias to the existing data
          const newAlias = data
          const existingAliases = oldData.items || []

          // Check if this alias name already exists (for transfer case)
          const existingIndex = existingAliases.findIndex(alias => alias.alias_name === newAlias.alias_name)
          if (existingIndex >= 0) {
            // Update existing alias (transfer case)
            existingAliases[existingIndex] = newAlias
          }
 else {
            // Add new alias
            existingAliases.push(newAlias)
          }

          return {
            ...oldData,
            items: existingAliases,
            limit: existingAliases.length,
          }
        },
      )
    },
  })
}

export const useDeleteWorkflowAlias = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (aliasId: string) => {
      return del(`/apps/${appId}/workflow-aliases?alias_id=${aliasId}`)
    },
    onSuccess: (data, variables) => {
      // Instead of invalidating all queries, update the specific cache
      // This prevents multiple network requests
      queryClient.setQueriesData(
        {
          queryKey: ['workflow-aliases', appId],
          exact: false,
        },
        (oldData: WorkflowAliasList | undefined) => {
          if (!oldData) return oldData

          // Remove the deleted alias from the existing data
          const existingAliases = oldData.items || []
          const filteredAliases = existingAliases.filter(alias => alias.id !== variables)

          return {
            ...oldData,
            items: filteredAliases,
            limit: filteredAliases.length,
          }
        },
      )
    },
  })
}
