import type {
  AgentLogDetailRequest,
  AgentLogDetailResponse,
  ChatMessagesRequest,
  ChatMessagesResponse,
  LogMessageAnnotationsRequest,
  LogMessageAnnotationsResponse,
  LogMessageFeedbacksRequest,
  LogMessageFeedbacksResponse,
  WorkflowRunDetailResponse,
} from '@/models/log'
import type { NodeTracingListResponse } from '@/types/workflow'
import { get, post } from './base'

// (Chat Application) Message list in one session
export const fetchChatMessages = ({ url, params }: { url: string, params: ChatMessagesRequest }): Promise<ChatMessagesResponse> => {
  return get<ChatMessagesResponse>(url, { params })
}

export const updateLogMessageFeedbacks = ({ url, body }: { url: string, body: LogMessageFeedbacksRequest }): Promise<LogMessageFeedbacksResponse> => {
  return post<LogMessageFeedbacksResponse>(url, { body })
}

export const updateLogMessageAnnotations = ({ url, body }: { url: string, body: LogMessageAnnotationsRequest }): Promise<LogMessageAnnotationsResponse> => {
  return post<LogMessageAnnotationsResponse>(url, { body })
}

export const fetchRunDetail = (url: string): Promise<WorkflowRunDetailResponse> => {
  return get<WorkflowRunDetailResponse>(url)
}

export const fetchTracingList = ({ url }: { url: string }): Promise<NodeTracingListResponse> => {
  return get<NodeTracingListResponse>(url)
}

export const fetchAgentLogDetail = ({ appID, params }: { appID: string, params: AgentLogDetailRequest }): Promise<AgentLogDetailResponse> => {
  return get<AgentLogDetailResponse>(`/apps/${appID}/agent/logs`, { params })
}
