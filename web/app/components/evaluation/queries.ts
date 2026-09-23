import type {
  EvaluationConfigPayload,
  EvaluationRunPayload,
} from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { EvaluationResourceProps } from './types'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

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

  const downloadTemplate = () => {
    if (resourceType === 'datasets') {
      return datasetTemplateMutation.mutateAsync({
        params: { dataset_id: resourceId },
      })
    }

    return targetTemplateMutation.mutateAsync({
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
