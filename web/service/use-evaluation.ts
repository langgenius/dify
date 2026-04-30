import type { EvaluationResourceType, NonPipelineEvaluationResourceType } from '@/app/components/evaluation/types'
import type { AvailableEvaluationWorkflowsResponse, EvaluationConfig } from '@/types/evaluation'
import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
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

const getEvaluationConfigQueryOptions = (
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  return consoleQuery.evaluation.config.queryOptions({
    input: {
      params: {
        targetType: resourceType,
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

export const useDatasetEvaluationMetrics = (datasetId: string, enabled = true) => {
  return useQuery(consoleQuery.datasetEvaluation.metrics.queryOptions({
    input: datasetId
      ? {
          params: {
            datasetId,
          },
        }
      : skipToken,
    enabled: !!datasetId && enabled,
    refetchOnWindowFocus: false,
  }))
}

export const useDefaultEvaluationMetrics = (
  resourceType: NonPipelineEvaluationResourceType,
  resourceId: string,
  enabled = true,
) => {
  return useQuery(consoleQuery.evaluation.defaultMetrics.queryOptions({
    input: {
      params: {
        targetType: resourceType,
        targetId: resourceId,
      },
    },
    enabled: !!resourceId && enabled,
    refetchOnWindowFocus: false,
  }))
}

export const useEvaluationWorkflowAssociatedTargets = (
  workflowId: string | undefined,
  options?: { enabled?: boolean },
) => {
  return useQuery(consoleQuery.evaluation.associatedTargets.queryOptions({
    input: workflowId
      ? {
          params: {
            workflowId,
          },
        }
      : skipToken,
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    refetchOnWindowFocus: false,
    retry: false,
  }))
}

export const useEvaluationNodeInfoMutation = () => {
  return useMutation(consoleQuery.evaluation.nodeInfo.mutationOptions())
}

export const useSaveEvaluationConfigMutation = () => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.evaluation.saveConfig.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.evaluation.config.key(),
      })
    },
  }))
}

export const useStartEvaluationRunMutation = () => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.evaluation.startRun.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.evaluation.logs.key(),
      })
    },
  }))
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
