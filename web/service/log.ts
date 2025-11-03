import type { Fetcher } from 'swr'
import { del, get, post } from './base'
import { mutate } from 'swr'
import { clearConversationIds } from '@/utils/localStorage'
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

export const fetchWorkflowLogs: Fetcher<WorkflowLogsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<WorkflowLogsResponse>(url, { params })
}

export const fetchRunDetail = (url: string) => {
  return get<WorkflowRunDetailResponse>(url)
}

export const fetchTracingList: Fetcher<NodeTracingListResponse, { url: string }> = ({ url }) => {
  return get<NodeTracingListResponse>(url)
}

export const fetchAgentLogDetail = ({ appID, params }: { appID: string; params: AgentLogDetailRequest }) => {
  return get<AgentLogDetailResponse>(`/apps/${appID}/agent/logs`, { params })
}

// Clear chat conversations (all or selected)
export const clearChatConversations = async ({ appId, conversationIds }: { appId: string; conversationIds?: string[] }) => {
  try {
    const body = conversationIds && conversationIds.length > 0
      ? { conversation_ids: conversationIds }
      : { conversation_ids: [] }

    const result = await del<any>(`/apps/${appId}/chat-conversations`, { body })

    // Clear localStorage to prevent 404 errors
    clearConversationIds(appId)

    // Clear SWR caches to force reload of conversation lists
    await Promise.all([
      // Clear log list caches (key is an object with url and params)
      // Force cache invalidation with populateCache: false
      mutate(
        key =>
          typeof key === 'object' && key !== null && 'url' in key
          && (key.url === `/apps/${appId}/chat-conversations` || key.url === `/apps/${appId}/completion-conversations`),
        undefined,
        {
          revalidate: true,
          populateCache: false,
        },
      ),
      // Clear explore apps caches
      mutate(
        key =>
          typeof key === 'string' && key.includes('/explore/apps'),
        undefined,
        { revalidate: false },
      ),
      // Clear conversation list caches to trigger validation in useChatWithHistory
      mutate(
        key =>
          Array.isArray(key) && key[0] === 'appConversationData' && key[2] === appId,
        undefined,
        { revalidate: true },
      ),
    ])

    return result
  }
  catch (error) {
    console.error('Failed to clear chat conversations:', error)
    if (error instanceof Error)
      throw new Error(`Failed to clear chat conversations: ${error.message}`)

    throw new Error('Failed to clear chat conversations')
  }
}

// Clear completion conversations (all or selected)
export const clearCompletionConversations = async ({ appId, conversationIds }: { appId: string; conversationIds?: string[] }) => {
  try {
    const body = conversationIds && conversationIds.length > 0
      ? { conversation_ids: conversationIds }
      : { conversation_ids: [] }

    const result = await del<any>(`/apps/${appId}/completion-conversations`, { body })

    // Clear localStorage to prevent 404 errors
    clearConversationIds(appId)

    // Clear SWR caches to force reload of conversation lists
    await Promise.all([
      // Clear log list caches (key is an object with url and params)
      // Force cache invalidation with populateCache: false
      mutate(
        key =>
          typeof key === 'object' && key !== null && 'url' in key
          && (key.url === `/apps/${appId}/chat-conversations` || key.url === `/apps/${appId}/completion-conversations`),
        undefined,
        {
          revalidate: true,
          populateCache: false,
        },
      ),
      // Clear explore apps caches
      mutate(
        key =>
          typeof key === 'string' && key.includes('/explore/apps'),
        undefined,
        { revalidate: false },
      ),
      // Clear conversation list caches to trigger validation in useChatWithHistory
      mutate(
        key =>
          Array.isArray(key) && key[0] === 'appConversationData' && key[2] === appId,
        undefined,
        { revalidate: true },
      ),
    ])

    return result
  }
  catch (error) {
    console.error('Failed to clear completion conversations:', error)
    if (error instanceof Error)
      throw new Error(`Failed to clear completion conversations: ${error.message}`)

    throw new Error('Failed to clear completion conversations')
  }
}
