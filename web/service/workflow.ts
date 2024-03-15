import type { Fetcher } from 'swr'
import { get, post } from './base'
import type { CommonResponse } from '@/models/common'
import type {
  FetchWorkflowDraftResponse,
  NodesDefaultConfigsResponse,
  WorkflowRunHistoryResponse,
} from '@/types/workflow'

export const fetchWorkflowDraft: Fetcher<FetchWorkflowDraftResponse, string> = (url) => {
  return get<FetchWorkflowDraftResponse>(url, {}, { silent: true })
}

export const syncWorkflowDraft = ({ url, params }: { url: string; params: Pick<FetchWorkflowDraftResponse, 'graph' | 'features'> }) => {
  return post<CommonResponse & { updated_at: number }>(url, { body: params })
}

export const fetchNodesDefaultConfigs: Fetcher<NodesDefaultConfigsResponse, string> = (url) => {
  return get<NodesDefaultConfigsResponse>(url)
}

export const fetchWorkflowRunHistory: Fetcher<WorkflowRunHistoryResponse, string> = (url) => {
  return get<WorkflowRunHistoryResponse>(url)
}

export const singleNodeRun = (appId: string, nodeId: string, params: object) => {
  return post(`apps/${appId}/workflows/draft/nodes/${nodeId}/run`, { body: params })
}

export const publishWorkflow = (url: string) => {
  return post<CommonResponse>(url)
}

export const stopWorkflowRun = (url: string) => {
  return post<CommonResponse>(url)
}
