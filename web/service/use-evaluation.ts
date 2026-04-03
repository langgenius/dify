import type { AvailableEvaluationWorkflowsResponse } from '@/types/evaluation'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

type AvailableEvaluationWorkflowsParams = {
  page?: number
  limit?: number
  keyword?: string
  userId?: string
}

const normalizeAvailableEvaluationWorkflowsParams = (params: AvailableEvaluationWorkflowsParams = {}) => {
  const page = params.page ?? 1
  const limit = params.limit ?? 20
  const keyword = params.keyword?.trim()
  const userId = params.userId?.trim()

  return {
    page,
    limit,
    ...(keyword ? { keyword } : {}),
    ...(userId ? { user_id: userId } : {}),
  }
}

export const useAvailableEvaluationMetrics = (enabled = true) => {
  return useQuery(consoleQuery.evaluation.availableMetrics.queryOptions({
    enabled,
  }))
}

export const useEvaluationNodeInfoMutation = () => {
  return useMutation(consoleQuery.evaluation.nodeInfo.mutationOptions())
}

export const useAvailableEvaluationWorkflows = (
  params: AvailableEvaluationWorkflowsParams = {},
  options?: { enabled?: boolean },
) => {
  const queryParams = normalizeAvailableEvaluationWorkflowsParams(params)

  return useInfiniteQuery<AvailableEvaluationWorkflowsResponse>({
    queryKey: consoleQuery.evaluation.availableWorkflows.queryKey({
      input: {
        query: queryParams,
      },
    }),
    queryFn: ({ pageParam = queryParams.page }) => {
      return consoleClient.evaluation.availableWorkflows({
        query: {
          ...queryParams,
          page: Number(pageParam),
        },
      })
    },
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: queryParams.page,
    placeholderData: keepPreviousData,
    ...options,
  })
}
