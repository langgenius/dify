import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracingListResponse } from '@/types/workflow'
// oxlint-disable-next-line no-restricted-imports -- Run detail and tracing URLs are supplied by the workflow log surface.
import { get } from './base'

export const fetchRunDetail = (
  url: string,
  options?: { silent?: boolean },
): Promise<WorkflowRunDetailResponse> => {
  return get<WorkflowRunDetailResponse>(url, {}, options)
}

export const fetchTracingList = (
  { url }: { url: string },
  options?: { silent?: boolean },
): Promise<NodeTracingListResponse> => {
  return get<NodeTracingListResponse>(url, {}, options)
}
