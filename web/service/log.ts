import { get, post } from './base'
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

export const fetchConversationList = ({ appId, params }: { name: string; appId: string; params?: Record<string, any> }): Promise<ConversationListResponse> => get<ConversationListResponse>(`/console/api/apps/${appId}/messages`, params)

// (Text Generation Application) Session List
export const fetchCompletionConversations = ({ url, params }: { url: string; params?: CompletionConversationsRequest }): Promise<CompletionConversationsResponse> => get<CompletionConversationsResponse>(url, { params })

// (Text Generation Application) Session Detail
export const fetchCompletionConversationDetail = ({ url }: { url: string }): Promise<CompletionConversationFullDetailResponse> => get<CompletionConversationFullDetailResponse>(url, {})

// (Chat Application) Session List
export const fetchChatConversations = ({ url, params }: { url: string; params?: ChatConversationsRequest }): Promise<ChatConversationsResponse> => get<ChatConversationsResponse>(url, { params })

// (Chat Application) Session Detail
export const fetchChatConversationDetail = ({ url }: { url: string }): Promise<ChatConversationFullDetailResponse> => get<ChatConversationFullDetailResponse>(url, {})

// (Chat Application) Message list in one session
export const fetchChatMessages = ({ url, params }: { url: string; params: ChatMessagesRequest }): Promise<ChatMessagesResponse> => get<ChatMessagesResponse>(url, { params })

export const updateLogMessageFeedbacks = ({ url, body }: { url: string; body: LogMessageFeedbacksRequest }): Promise<LogMessageFeedbacksResponse> => post<LogMessageFeedbacksResponse>(url, { body })

export const updateLogMessageAnnotations = ({ url, body }: { url: string; body: LogMessageAnnotationsRequest }): Promise<LogMessageAnnotationsResponse> => post<LogMessageAnnotationsResponse>(url, { body })

export const fetchAnnotationsCount = ({ url }: { url: string }): Promise<AnnotationsCountResponse> => get<AnnotationsCountResponse>(url)

export const fetchWorkflowLogs = ({ url, params }: { url: string; params: Record<string, any> }): Promise<WorkflowLogsResponse> => get<WorkflowLogsResponse>(url, { params })

export const fetchRunDetail = (url: string): Promise<WorkflowRunDetailResponse> => get<WorkflowRunDetailResponse>(url)

export const fetchTracingList = ({ url }: { url: string }): Promise<NodeTracingListResponse> => get<NodeTracingListResponse>(url)

export const fetchAgentLogDetail = ({ appID, params }: { appID: string; params: AgentLogDetailRequest }): Promise<AgentLogDetailResponse> => get<AgentLogDetailResponse>(`/apps/${appID}/agent/logs`, { params })
