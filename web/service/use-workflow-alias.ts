import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post } from './base'
import type { WorkflowAlias, WorkflowAliasList } from '@/app/components/workflow/types'

export const useWorkflowAliasList = ({
  appId,
  workflowIds,
  limit = 100,
  offset = 0,
}: {
  appId: string
  workflowIds?: string[]
  limit?: number
  offset?: number
}) => {
  return useQuery<WorkflowAliasList>({
    queryKey: ['workflow-aliases', appId, workflowIds, limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams()

      if (workflowIds && workflowIds.length > 0)
        params.append('workflow_ids', workflowIds.join(','))

      params.append('limit', limit.toString())
      params.append('offset', offset.toString())

      const queryString = params.toString()
      const url = queryString ? `/apps/${appId}/workflow-aliases?${queryString}` : `/apps/${appId}/workflow-aliases`

      return get<WorkflowAliasList>(url)
    },
    enabled: !!appId && (workflowIds === undefined || workflowIds.length > 0),
  })
}

export const useWorkflowAliasListPaginated = ({
  appId,
  workflowIds,
  limit = 100,
}: {
  appId: string
  workflowIds?: string[]
  limit?: number
}) => {
  return useInfiniteQuery<WorkflowAliasList>({
    queryKey: ['workflow-aliases-paginated', appId, workflowIds, limit],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()

      if (workflowIds && workflowIds.length > 0)
        params.append('workflow_ids', workflowIds.join(','))

      params.append('limit', limit.toString())
      params.append('offset', ((pageParam as number) * limit).toString())

      const queryString = params.toString()
      const url = `/apps/${appId}/workflow-aliases?${queryString}`

      const response = await get<WorkflowAliasList>(url)
      return response
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.has_more)
        return allPages.length
      return undefined
    },
    enabled: !!appId && (workflowIds === undefined || workflowIds.length > 0),
  })
}

export const useCreateWorkflowAlias = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      workflow_id: string
      name: string
    }) => {
      return post<WorkflowAlias>(`/apps/${appId}/workflow-aliases`, {
        body: {
          workflow_id: data.workflow_id,
          name: data.name,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-aliases', appId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-aliases-paginated', appId] });
    },
  })
}

export const useDeleteWorkflowAlias = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (aliasId: string) => {
      return del(`/apps/${appId}/workflow-aliases/${aliasId}`)
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
