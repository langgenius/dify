import type {
  EvaluationConfigData,
  EvaluationNodeInfoRequest,
  EvaluationTargetType,
} from '@/types/evaluation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export type EvaluationResourceType = 'workflow' | 'pipeline' | 'snippet'

type EvaluationLogsParams = {
  page?: number
  page_size?: number
}

type EvaluationRunDetailParams = {
  page?: number
  page_size?: number
}

const toEvaluationTargetType = (resourceType: Exclude<EvaluationResourceType, 'pipeline'>): EvaluationTargetType => {
  return resourceType === 'snippet' ? 'snippets' : 'app'
}

const invalidateEvaluationQueries = async (
  queryClient: ReturnType<typeof useQueryClient>,
  resourceType: EvaluationResourceType,
) => {
  const queryKey = resourceType === 'pipeline'
    ? consoleQuery.datasetEvaluation.key()
    : consoleQuery.evaluation.key()

  await queryClient.invalidateQueries({ queryKey })
}

export const useEvaluationConfig = (resourceType: Exclude<EvaluationResourceType, 'pipeline'>, resourceId: string) => {
  return useQuery(consoleQuery.evaluation.config.queryOptions({
    input: {
      params: {
        targetType: toEvaluationTargetType(resourceType),
        targetId: resourceId,
      },
    },
    enabled: !!resourceId,
  }))
}

export const useDatasetEvaluationConfig = (datasetId: string) => {
  return useQuery(consoleQuery.datasetEvaluation.config.queryOptions({
    input: {
      params: { datasetId },
    },
    enabled: !!datasetId,
  }))
}

export const useEvaluationLogs = (
  resourceType: Exclude<EvaluationResourceType, 'pipeline'>,
  resourceId: string,
  params: EvaluationLogsParams = {},
) => {
  return useQuery(consoleQuery.evaluation.logs.queryOptions({
    input: {
      params: {
        targetType: toEvaluationTargetType(resourceType),
        targetId: resourceId,
      },
      query: params,
    },
    enabled: !!resourceId,
  }))
}

export const useDatasetEvaluationLogs = (datasetId: string, params: EvaluationLogsParams = {}) => {
  return useQuery(consoleQuery.datasetEvaluation.logs.queryOptions({
    input: {
      params: { datasetId },
      query: params,
    },
    enabled: !!datasetId,
  }))
}

export const useEvaluationMetrics = (resourceType: Exclude<EvaluationResourceType, 'pipeline'>, resourceId: string) => {
  return useQuery(consoleQuery.evaluation.metrics.queryOptions({
    input: {
      params: {
        targetType: toEvaluationTargetType(resourceType),
        targetId: resourceId,
      },
    },
    enabled: !!resourceId,
  }))
}

export const useDatasetEvaluationMetrics = (datasetId: string) => {
  return useQuery(consoleQuery.datasetEvaluation.metrics.queryOptions({
    input: {
      params: { datasetId },
    },
    enabled: !!datasetId,
  }))
}

export const useAvailableEvaluationMetrics = (enabled = true) => {
  return useQuery(consoleQuery.evaluation.availableMetrics.queryOptions({
    enabled,
  }))
}

export const useEvaluationNodeInfoMutation = () => {
  return useMutation(consoleQuery.evaluation.nodeInfo.mutationOptions())
}

export const useSaveEvaluationConfigMutation = (resourceType: Exclude<EvaluationResourceType, 'pipeline'>) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.evaluation.saveConfig.mutationOptions({
      onSuccess: async () => {
        await invalidateEvaluationQueries(queryClient, resourceType)
      },
    }),
  })
}

export const useSaveDatasetEvaluationConfigMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.datasetEvaluation.saveConfig.mutationOptions({
      onSuccess: async () => {
        await invalidateEvaluationQueries(queryClient, 'pipeline')
      },
    }),
  })
}

export const useStartEvaluationRunMutation = (resourceType: Exclude<EvaluationResourceType, 'pipeline'>) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.evaluation.startRun.mutationOptions({
      onSuccess: async () => {
        await invalidateEvaluationQueries(queryClient, resourceType)
      },
    }),
  })
}

export const useStartDatasetEvaluationRunMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.datasetEvaluation.startRun.mutationOptions({
      onSuccess: async () => {
        await invalidateEvaluationQueries(queryClient, 'pipeline')
      },
    }),
  })
}

export const useCancelEvaluationRunMutation = (resourceType: Exclude<EvaluationResourceType, 'pipeline'>) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.evaluation.cancelRun.mutationOptions({
      onSuccess: async () => {
        await invalidateEvaluationQueries(queryClient, resourceType)
      },
    }),
  })
}

export const useCancelDatasetEvaluationRunMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...consoleQuery.datasetEvaluation.cancelRun.mutationOptions({
      onSuccess: async () => {
        await invalidateEvaluationQueries(queryClient, 'pipeline')
      },
    }),
  })
}

export const useEvaluationRunDetail = (
  resourceType: Exclude<EvaluationResourceType, 'pipeline'>,
  resourceId: string,
  runId: string,
  params: EvaluationRunDetailParams = {},
) => {
  return useQuery(consoleQuery.evaluation.runDetail.queryOptions({
    input: {
      params: {
        targetType: toEvaluationTargetType(resourceType),
        targetId: resourceId,
        runId,
      },
      query: params,
    },
    enabled: !!resourceId && !!runId,
  }))
}

export const useDatasetEvaluationRunDetail = (datasetId: string, runId: string, params: EvaluationRunDetailParams = {}) => {
  return useQuery(consoleQuery.datasetEvaluation.runDetail.queryOptions({
    input: {
      params: {
        datasetId,
        runId,
      },
      query: params,
    },
    enabled: !!datasetId && !!runId,
  }))
}

export type {
  EvaluationConfigData,
  EvaluationNodeInfoRequest,
}
