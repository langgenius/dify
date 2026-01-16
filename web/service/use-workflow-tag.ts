import type { WorkflowTag, WorkflowTagList } from '@/app/components/workflow/types'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post } from './base'

export const useWorkflowTagList = ({
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
  return useQuery<WorkflowTagList>({
    queryKey: ['workflow-tags', appId, workflowIds, limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams()

      if (workflowIds && workflowIds.length > 0)
        params.append('workflow_ids', workflowIds.join(','))

      params.append('limit', limit.toString())
      params.append('offset', offset.toString())

      const queryString = params.toString()
      const url = queryString ? `/apps/${appId}/workflow-tags?${queryString}` : `/apps/${appId}/workflow-tags`

      return get<WorkflowTagList>(url)
    },
    enabled: !!appId && (workflowIds === undefined || workflowIds.length > 0),
  })
}

export const useWorkflowTagListPaginated = ({
  appId,
  workflowIds,
  limit = 100,
}: {
  appId: string
  workflowIds?: string[]
  limit?: number
}) => {
  return useInfiniteQuery<WorkflowTagList>({
    queryKey: ['workflow-tags-paginated', appId, workflowIds, limit],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()

      if (workflowIds && workflowIds.length > 0)
        params.append('workflow_ids', workflowIds.join(','))

      params.append('limit', limit.toString())
      params.append('offset', ((pageParam as number) * limit).toString())

      const queryString = params.toString()
      const url = `/apps/${appId}/workflow-tags?${queryString}`

      const response = await get<WorkflowTagList>(url)
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

export const useCreateWorkflowTag = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      workflow_id: string
      name: string
    }) => {
      return post<WorkflowTag>(`/apps/${appId}/workflow-tags`, {
        body: {
          workflow_id: data.workflow_id,
          name: data.name,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-tags', appId] })
      queryClient.invalidateQueries({ queryKey: ['workflow-tags-paginated', appId] })
    },
  })
}

export const useDeleteWorkflowTag = (appId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tagId: string) => {
      return del(`/apps/${appId}/workflow-tags/${tagId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-tags', appId] })
      queryClient.invalidateQueries({ queryKey: ['workflow-tags-paginated', appId] })
    },
  })
}
