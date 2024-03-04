import type { Fetcher } from 'swr'
import { get, post } from './base'
import type { CommonResponse } from '@/models/common'
import type {
  FetchWorkflowDraftResponse,
} from '@/types/workflow'

export const fetchWorkflowDraft: Fetcher<FetchWorkflowDraftResponse, string> = (url) => {
  return get<FetchWorkflowDraftResponse>(url, {}, { silent: true })
}

export const syncWorkflowDraft: Fetcher<CommonResponse, { url: string; params: Pick<FetchWorkflowDraftResponse, 'graph' | 'features'> }> = ({ url, params }) => {
  return post<CommonResponse>(url, { body: params })
}

export const fetchNodesDefaultConfigs: Fetcher<any, string> = (url) => {
  return get<any>(url)
}
