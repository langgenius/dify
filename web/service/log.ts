import type {
  AgentLogDetailRequest,
  AgentLogDetailResponse,
  AnnotationsCountResponse,
  ChatConversationFullDetailResponse,
  ChatConversationsRequest,
  ChatConversationsResponse,
  ChatMessagesRequest,
  ChatMessagesResponse,
  CompletionConversationFullDetailResponse,
  CompletionConversationsRequest,
  CompletionConversationsResponse,
  ConversationListResponse,
  LogMessageAnnotationsRequest,
  LogMessageAnnotationsResponse,
  LogMessageFeedbacksRequest,
  LogMessageFeedbacksResponse,
  WorkflowLogsResponse,
  WorkflowRunDetailResponse,
} from '@/models/log'
import type { NodeTracingListResponse } from '@/types/workflow'
import { get, post } from './base'

export const fetchConversationList = ({ appId, params }: { name?: string, appId: string, params?: Record<string, any> }): Promise<ConversationListResponse> => {
  return get<ConversationListResponse>(`/console/api/apps/${appId}/messages`, params)
}

// (Text Generation Application) Session List
export const fetchCompletionConversations = ({ url, params }: { url: string, params?: CompletionConversationsRequest }): Promise<CompletionConversationsResponse> => {
  return get<CompletionConversationsResponse>(url, { params })
}

// (Text Generation Application) Session Detail
export const fetchCompletionConversationDetail = ({ url }: { url: string }): Promise<CompletionConversationFullDetailResponse> => {
  return get<CompletionConversationFullDetailResponse>(url, {})
}

// (Chat Application) Session List
export const fetchChatConversations = ({ url, params }: { url: string, params?: ChatConversationsRequest }): Promise<ChatConversationsResponse> => {
  return get<ChatConversationsResponse>(url, { params })
}

// (Chat Application) Session Detail
export const fetchChatConversationDetail = ({ url }: { url: string }): Promise<ChatConversationFullDetailResponse> => {
  return get<ChatConversationFullDetailResponse>(url, {})
}

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

export const fetchAnnotationsCount = ({ url }: { url: string }): Promise<AnnotationsCountResponse> => {
  return get<AnnotationsCountResponse>(url)
}

export const fetchWorkflowLogs = ({ url, params }: { url: string, params: Record<string, any> }): Promise<WorkflowLogsResponse> => {
  return get<WorkflowLogsResponse>(url, { params })
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
