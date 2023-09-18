import type { Fetcher } from 'swr'
import { get, post } from './base'
import type {
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
} from '@/models/log'

export const fetchConversationList: Fetcher<ConversationListResponse, { name: string; appId: string; params?: Record<string, any> }> = ({ appId, params }) => {
  return get<ConversationListResponse>(`/console/api/apps/${appId}/messages`, params)
}

// (Text Generation Application) Session List
export const fetchCompletionConversations: Fetcher<CompletionConversationsResponse, { url: string; params?: CompletionConversationsRequest }> = ({ url, params }) => {
  return get<CompletionConversationsResponse>(url, { params })
}

// (Text Generation Application) Session Detail
export const fetchCompletionConversationDetail: Fetcher<CompletionConversationFullDetailResponse, { url: string }> = ({ url }) => {
  return get<CompletionConversationFullDetailResponse>(url, {})
}

// (Chat Application) Session List
export const fetchChatConversations: Fetcher<ChatConversationsResponse, { url: string; params?: ChatConversationsRequest }> = ({ url, params }) => {
  return get<ChatConversationsResponse>(url, { params })
}

// (Chat Application) Session Detail
export const fetchChatConversationDetail: Fetcher<ChatConversationFullDetailResponse, { url: string }> = ({ url }) => {
  return get<ChatConversationFullDetailResponse>(url, {})
}

// (Chat Application) Message list in one session
export const fetchChatMessages: Fetcher<ChatMessagesResponse, { url: string; params: ChatMessagesRequest }> = ({ url, params }) => {
  return get<ChatMessagesResponse>(url, { params })
}

export const updateLogMessageFeedbacks: Fetcher<LogMessageFeedbacksResponse, { url: string; body: LogMessageFeedbacksRequest }> = ({ url, body }) => {
  return post<LogMessageFeedbacksResponse>(url, { body })
}

export const updateLogMessageAnnotations: Fetcher<LogMessageAnnotationsResponse, { url: string; body: LogMessageAnnotationsRequest }> = ({ url, body }) => {
  return post<LogMessageAnnotationsResponse>(url, { body })
}

export const fetchAnnotationsCount: Fetcher<AnnotationsCountResponse, { url: string }> = ({ url }) => {
  return get<AnnotationsCountResponse>(url)
}
