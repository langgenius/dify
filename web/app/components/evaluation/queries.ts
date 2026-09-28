import type {
  EvaluationConfigPayload,
  EvaluationRunPayload,
} from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { EvaluationResourceProps, NonDatasetEvaluationResourceType } from './types'
import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'

export const EVALUATION_POLLING_INTERVAL = 2500

type EvaluationPagination = {
  page?: number
  pageSize?: number
}

type EvaluationRunDetailParams = EvaluationPagination & {
  runId: string | null
}

export const isEvaluationRunActive = (status: string | null | undefined) => {
  return status === 'pending' || status === 'running'
}

export const shouldPollEvaluationLogs = (statuses: Array<string | null | undefined>) => {
  return statuses.some(isEvaluationRunActive)
}

type AvailableEvaluationWorkflowsParams = {
  page?: number
  limit?: number
  keyword?: string
  userId?: string
}

const normalizeAvailableEvaluationWorkflowsParams = (
  params: AvailableEvaluationWorkflowsParams = {},
) => {
  const keyword = params.keyword?.trim()
  const userId = params.userId?.trim()

  return {
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    ...(keyword ? { keyword } : {}),
    ...(userId ? { user_id: userId } : {}),
  }
}

export const useDatasetEvaluationMetrics = (datasetId: string, enabled = true) => {
  return useQuery(
    consoleQuery.datasets.byDatasetId.evaluation.metrics.get.queryOptions({
      input: datasetId && enabled ? { params: { dataset_id: datasetId } } : skipToken,
      refetchOnWindowFocus: false,
    }),
  )
}

export const useDefaultEvaluationMetrics = (
  resourceType: NonDatasetEvaluationResourceType,
  resourceId: string,
  enabled = true,
) => {
  return useQuery(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.defaultMetrics.get.queryOptions(
      {
        input:
          resourceId && enabled
            ? {
                params: {
                  evaluate_target_id: resourceId,
                  evaluate_target_type: resourceType,
                },
              }
            : skipToken,
        refetchOnWindowFocus: false,
      },
    ),
  )
}

export const useEvaluationNodeInfoMutation = () => {
  return useMutation(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.nodeInfo.post.mutationOptions(),
  )
}

export const useEvaluationTemplateColumns = (
  { resourceType, resourceId }: EvaluationResourceProps,
  configPayload: EvaluationConfigPayload,
) => {
  return useQuery(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.templateColumns.post.queryOptions(
      {
        input:
          resourceType !== 'datasets' && resourceId
            ? {
                body: configPayload,
                params: {
                  evaluate_target_id: resourceId,
                  evaluate_target_type: resourceType,
                },
              }
            : skipToken,
        refetchOnWindowFocus: false,
      },
    ),
  )
}

export const useAvailableEvaluationWorkflows = (
  params: AvailableEvaluationWorkflowsParams = {},
  options?: { enabled?: boolean },
) => {
  const queryParams = normalizeAvailableEvaluationWorkflowsParams(params)

  return useInfiniteQuery({
    ...consoleQuery.workspaces.current.availableEvaluationWorkflows.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          ...queryParams,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: queryParams.page,
    }),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

export const getEvaluationFile = (
  { resourceType, resourceId }: EvaluationResourceProps,
  fileId: string,
) => {
  if (resourceType === 'datasets') {
    return consoleClient.datasets.byDatasetId.evaluation.files.byFileId.get({
      params: { dataset_id: resourceId, file_id: fileId },
    })
  }

  return consoleClient.byEvaluateTargetType.byEvaluateTargetId.evaluation.files.byFileId.get({
    params: {
      evaluate_target_id: resourceId,
      evaluate_target_type: resourceType,
      file_id: fileId,
    },
  })
}

export const useEvaluationConfigQuery = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const datasetQuery = useQuery(
    consoleQuery.datasets.byDatasetId.evaluation.get.queryOptions({
      input:
        resourceType === 'datasets' && resourceId
          ? { params: { dataset_id: resourceId } }
          : skipToken,
    }),
  )
  const targetQuery = useQuery(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.get.queryOptions({
      input:
        resourceType !== 'datasets' && resourceId
          ? {
              params: {
                evaluate_target_id: resourceId,
                evaluate_target_type: resourceType,
              },
            }
          : skipToken,
    }),
  )

  return resourceType === 'datasets' ? datasetQuery : targetQuery
}

export const useEvaluationLogsQuery = (
  { resourceType, resourceId }: EvaluationResourceProps,
  { page, pageSize }: EvaluationPagination = {},
) => {
  const datasetQuery = useQuery(
    consoleQuery.datasets.byDatasetId.evaluation.logs.get.queryOptions({
      input:
        resourceType === 'datasets' && resourceId
          ? {
              params: { dataset_id: resourceId },
              query: { page, page_size: pageSize },
            }
          : skipToken,
      refetchInterval: (query) =>
        shouldPollEvaluationLogs(query.state.data?.data.map((run) => run.status) ?? [])
          ? EVALUATION_POLLING_INTERVAL
          : false,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    }),
  )
  const targetQuery = useQuery(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.queryOptions({
      input:
        resourceType !== 'datasets' && resourceId
          ? {
              params: {
                evaluate_target_id: resourceId,
                evaluate_target_type: resourceType,
              },
              query: { page, page_size: pageSize },
            }
          : skipToken,
      refetchInterval: (query) =>
        shouldPollEvaluationLogs(query.state.data?.data.map((run) => run.status) ?? [])
          ? EVALUATION_POLLING_INTERVAL
          : false,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    }),
  )

  return resourceType === 'datasets' ? datasetQuery : targetQuery
}

export const useEvaluationRunDetailQuery = (
  { resourceType, resourceId }: EvaluationResourceProps,
  { runId, page, pageSize }: EvaluationRunDetailParams,
) => {
  const datasetQuery = useQuery(
    consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.queryOptions({
      input:
        resourceType === 'datasets' && resourceId && runId
          ? {
              params: { dataset_id: resourceId, run_id: runId },
              query: { page, page_size: pageSize },
            }
          : skipToken,
      refetchInterval: (query) =>
        isEvaluationRunActive(query.state.data?.run.status) ? EVALUATION_POLLING_INTERVAL : false,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    }),
  )
  const targetQuery = useQuery(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.queryOptions({
      input:
        resourceType !== 'datasets' && resourceId && runId
          ? {
              params: {
                evaluate_target_id: resourceId,
                evaluate_target_type: resourceType,
                run_id: runId,
              },
              query: { page, page_size: pageSize },
            }
          : skipToken,
      refetchInterval: (query) =>
        isEvaluationRunActive(query.state.data?.run.status) ? EVALUATION_POLLING_INTERVAL : false,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    }),
  )

  return resourceType === 'datasets' ? datasetQuery : targetQuery
}

export const useEvaluationActions = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const datasetConfigMutation = useMutation(
    consoleQuery.datasets.byDatasetId.evaluation.put.mutationOptions(),
  )
  const targetConfigMutation = useMutation(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.put.mutationOptions(),
  )
  const datasetRunMutation = useMutation(
    consoleQuery.datasets.byDatasetId.evaluation.run.post.mutationOptions(),
  )
  const targetRunMutation = useMutation(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.run.post.mutationOptions(),
  )
  const datasetCancelMutation = useMutation(
    consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.cancel.post.mutationOptions(),
  )
  const targetCancelMutation = useMutation(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.cancel.post.mutationOptions(),
  )
  const datasetRetryMutation = useMutation(
    consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.retry.post.mutationOptions(),
  )
  const targetRetryMutation = useMutation(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.retry.post.mutationOptions(),
  )
  const datasetTemplateMutation = useMutation(
    consoleQuery.datasets.byDatasetId.evaluation.template.download.post.mutationOptions(),
  )
  const targetTemplateMutation = useMutation(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.datasetTemplate.download.post.mutationOptions(),
  )

  const saveConfig = (body: EvaluationConfigPayload) => {
    if (resourceType === 'datasets') {
      return datasetConfigMutation.mutateAsync({
        body,
        params: { dataset_id: resourceId },
      })
    }

    return targetConfigMutation.mutateAsync({
      body,
      params: {
        evaluate_target_id: resourceId,
        evaluate_target_type: resourceType,
      },
    })
  }

  const runEvaluation = (body: EvaluationRunPayload) => {
    if (resourceType === 'datasets') {
      return datasetRunMutation.mutateAsync({
        body,
        params: { dataset_id: resourceId },
      })
    }

    return targetRunMutation.mutateAsync({
      body,
      params: {
        evaluate_target_id: resourceId,
        evaluate_target_type: resourceType,
      },
    })
  }

  const cancelRun = (runId: string) => {
    if (resourceType === 'datasets') {
      return datasetCancelMutation.mutateAsync({
        params: { dataset_id: resourceId, run_id: runId },
      })
    }

    return targetCancelMutation.mutateAsync({
      params: {
        evaluate_target_id: resourceId,
        evaluate_target_type: resourceType,
        run_id: runId,
      },
    })
  }

  const retryRun = (runId: string) => {
    if (resourceType === 'datasets') {
      return datasetRetryMutation.mutateAsync({
        params: { dataset_id: resourceId, run_id: runId },
      })
    }

    return targetRetryMutation.mutateAsync({
      params: {
        evaluate_target_id: resourceId,
        evaluate_target_type: resourceType,
        run_id: runId,
      },
    })
  }

  const downloadTemplate = (configPayload: EvaluationConfigPayload = {}) => {
    if (resourceType === 'datasets') {
      return datasetTemplateMutation.mutateAsync({
        params: { dataset_id: resourceId },
      })
    }

    return targetTemplateMutation.mutateAsync({
      body: configPayload,
      params: {
        evaluate_target_id: resourceId,
        evaluate_target_type: resourceType,
      },
    })
  }

  return {
    cancelRun,
    downloadTemplate,
    isCancelling: datasetCancelMutation.isPending || targetCancelMutation.isPending,
    isDownloadingTemplate: datasetTemplateMutation.isPending || targetTemplateMutation.isPending,
    isRetrying: datasetRetryMutation.isPending || targetRetryMutation.isPending,
    isRunning: datasetRunMutation.isPending || targetRunMutation.isPending,
    isSaving: datasetConfigMutation.isPending || targetConfigMutation.isPending,
    retryRun,
    runEvaluation,
    saveConfig,
  }
}
