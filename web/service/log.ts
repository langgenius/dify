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
  LogMessageAnnotationsRequest,
  LogMessageAnnotationsResponse,
  LogMessageFeedbacksRequest,
  LogMessageFeedbacksResponse,
  WorkflowLogsResponse,
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

export const fetchAnnotationsCount = (appId: string): Promise<AnnotationsCountResponse> => {
  return get<AnnotationsCountResponse>(`/apps/${appId}/annotations/count`)
}

export const fetchChatConversations = (appId: string, params?: Partial<ChatConversationsRequest>): Promise<ChatConversationsResponse> => {
  return get<ChatConversationsResponse>(`/apps/${appId}/chat-conversations`, { params })
}

export const fetchCompletionConversations = (appId: string, params?: Partial<CompletionConversationsRequest>): Promise<CompletionConversationsResponse> => {
  return get<CompletionConversationsResponse>(`/apps/${appId}/completion-conversations`, { params })
}

export const fetchChatConversationDetail = (appId: string, conversationId: string): Promise<ChatConversationFullDetailResponse> => {
  return get<ChatConversationFullDetailResponse>(`/apps/${appId}/chat-conversations/${conversationId}`)
}

export const fetchCompletionConversationDetail = (appId: string, conversationId: string): Promise<CompletionConversationFullDetailResponse> => {
  return get<CompletionConversationFullDetailResponse>(`/apps/${appId}/completion-conversations/${conversationId}`)
}

export const fetchWorkflowLogs = (appId: string, params?: Record<string, string | number | boolean | undefined>): Promise<WorkflowLogsResponse> => {
  return get<WorkflowLogsResponse>(`/apps/${appId}/workflow-app-logs`, { params })
}
