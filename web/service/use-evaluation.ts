import type { EvaluationResourceType } from '@/app/components/evaluation/types'
import type { AvailableEvaluationWorkflowsResponse, EvaluationConfig } from '@/types/evaluation'
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

const toEvaluationTargetType = (resourceType: Exclude<EvaluationResourceType, 'datasets'>) => {
  return resourceType === 'snippets' ? 'snippets' : 'app'
}

const getEvaluationConfigQueryOptions = (
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  if (resourceType === 'datasets') {
    return consoleQuery.datasetEvaluation.config.queryOptions({
      input: {
        params: {
          datasetId: resourceId,
        },
      },
      enabled: !!resourceId,
      refetchOnWindowFocus: false,
    })
  }

  return consoleQuery.evaluation.config.queryOptions({
    input: {
      params: {
        targetType: toEvaluationTargetType(resourceType),
        targetId: resourceId,
      },
    },
    enabled: !!resourceId,
    refetchOnWindowFocus: false,
  })
}

export const useEvaluationConfig = (
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  return useQuery<EvaluationConfig>(getEvaluationConfigQueryOptions(resourceType, resourceId))
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
