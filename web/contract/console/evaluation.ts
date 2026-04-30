import type {
  AvailableEvaluationWorkflowsResponse,
  EvaluationConfig,
  EvaluationConfigData,
  EvaluationDefaultMetricsResponse,
  EvaluationDefaultMetricsTargetType,
  EvaluationFileInfo,
  EvaluationLogsResponse,
  EvaluationMetricsListResponse,
  EvaluationMetricsMapResponse,
  EvaluationNodeInfoRequest,
  EvaluationNodeInfoResponse,
  EvaluationRun,
  EvaluationRunDetailResponse,
  EvaluationRunRequest,
  EvaluationTargetType,
  EvaluationVersionDetailResponse,
  EvaluationWorkflowAssociatedTargetsResponse,
} from '@/types/evaluation'
import { type } from '@orpc/contract'
import { base } from '../base'

export const datasetEvaluationTemplateDownloadContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/template/download',
    method: 'POST',
  })
  .input(type<{
    params: {
      datasetId: string
    }
  }>())
  .output(type<unknown>())

export const datasetEvaluationConfigContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
    }
  }>())
  .output(type<EvaluationConfig>())

export const saveDatasetEvaluationConfigContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation',
    method: 'PUT',
  })
  .input(type<{
    params: {
      datasetId: string
    }
    body: EvaluationConfigData
  }>())
  .output(type<EvaluationConfig>())

export const startDatasetEvaluationRunContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/run',
    method: 'POST',
  })
  .input(type<{
    params: {
      datasetId: string
    }
    body: EvaluationRunRequest
  }>())
  .output(type<EvaluationRun>())

export const datasetEvaluationLogsContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/logs',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
    }
    query: {
      page?: number
      page_size?: number
    }
  }>())
  .output(type<EvaluationLogsResponse>())

export const datasetEvaluationRunDetailContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/runs/{runId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
      runId: string
    }
    query: {
      page?: number
      page_size?: number
    }
  }>())
  .output(type<EvaluationRunDetailResponse>())

export const cancelDatasetEvaluationRunContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/runs/{runId}/cancel',
    method: 'POST',
  })
  .input(type<{
    params: {
      datasetId: string
      runId: string
    }
  }>())
  .output(type<EvaluationRun>())

export const datasetEvaluationMetricsContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/metrics',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
    }
  }>())
  .output(type<EvaluationMetricsListResponse>())

export const datasetEvaluationFileContract = base
  .route({
    path: '/datasets/{datasetId}/evaluation/files/{fileId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      datasetId: string
      fileId: string
    }
  }>())
  .output(type<EvaluationFileInfo>())

export const evaluationTemplateDownloadContract = base
  .route({
    path: '/{targetType}/{targetId}/dataset-template/download',
    method: 'POST',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
  }>())
  .output(type<unknown>())

export const evaluationConfigContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
  }>())
  .output(type<EvaluationConfig>())

export const saveEvaluationConfigContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation',
    method: 'PUT',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
    body: EvaluationConfigData
  }>())
  .output(type<EvaluationConfig>())

export const evaluationLogsContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/logs',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
    query: {
      page?: number
      page_size?: number
    }
  }>())
  .output(type<EvaluationLogsResponse>())

export const startEvaluationRunContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/run',
    method: 'POST',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
    body: EvaluationRunRequest
  }>())
  .output(type<EvaluationRun>())

export const evaluationRunDetailContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/runs/{runId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
      runId: string
    }
    query: {
      page?: number
      page_size?: number
    }
  }>())
  .output(type<EvaluationRunDetailResponse>())

export const cancelEvaluationRunContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/runs/{runId}/cancel',
    method: 'POST',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
      runId: string
    }
  }>())
  .output(type<EvaluationRun>())

export const evaluationMetricsContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/metrics',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
  }>())
  .output(type<EvaluationMetricsMapResponse>())

export const evaluationDefaultMetricsContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/default-metrics',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationDefaultMetricsTargetType
      targetId: string
    }
  }>())
  .output(type<EvaluationDefaultMetricsResponse>())

export const evaluationNodeInfoContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/node-info',
    method: 'POST',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
    body: EvaluationNodeInfoRequest
  }>())
  .output(type<EvaluationNodeInfoResponse>())

export const availableEvaluationWorkflowsContract = base
  .route({
    path: '/workspaces/current/available-evaluation-workflows',
    method: 'GET',
  })
  .input(type<{
    query: {
      page?: number
      limit?: number
      keyword?: string
      user_id?: string
    }
  }>())
  .output(type<AvailableEvaluationWorkflowsResponse>())

export const evaluationWorkflowAssociatedTargetsContract = base
  .route({
    path: '/workspaces/current/evaluation-workflows/{workflowId}/associated-targets',
    method: 'GET',
  })
  .input(type<{
    params: {
      workflowId: string
    }
  }>())
  .output(type<EvaluationWorkflowAssociatedTargetsResponse>())

export const evaluationFileContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/files/{fileId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
      fileId: string
    }
  }>())
  .output(type<EvaluationFileInfo>())

export const evaluationVersionDetailContract = base
  .route({
    path: '/{targetType}/{targetId}/evaluation/version',
    method: 'GET',
  })
  .input(type<{
    params: {
      targetType: EvaluationTargetType
      targetId: string
    }
    query: {
      version: string
    }
  }>())
  .output(type<EvaluationVersionDetailResponse>())
