import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracingListResponse } from '@/types/workflow'
import { get } from './base'

export const fetchRunDetail = (url: string): Promise<WorkflowRunDetailResponse> => {
  return get<WorkflowRunDetailResponse>(url)
}

export const fetchTracingList = ({ url }: { url: string }): Promise<NodeTracingListResponse> => {
  return get<NodeTracingListResponse>(url)
}
