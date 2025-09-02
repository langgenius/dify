import type { Fetcher } from 'swr'
import { del, get, post } from './base'
import { mutate } from 'swr'
import { CONVERSATION_ID_INFO } from '../app/components/base/chat/constants'
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

export const fetchRunDetail = ({ appID, runID }: { appID: string; runID: string }) => {
  return get<WorkflowRunDetailResponse>(`/apps/${appID}/workflow-runs/${runID}`)
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
    const body = conversationIds ? { conversation_ids: conversationIds } : {}
    const result = await del<any>(`/apps/${appId}/chat-conversations`, { body })

    // Clear localStorage to prevent 404 errors on explore pages
    if (typeof window !== 'undefined') {
      const conversationIdInfo = JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO) || '{}')
      
      // Clear conversation ID for the current app (from logs page)
      let cleared = false
      if (conversationIdInfo[appId]) {
        delete conversationIdInfo[appId]
        cleared = true
        console.log(`✅ Cleared conversation ID info for app ${appId}`)
      }
      
      // ADDITIONAL FIX: Also clear ALL conversation IDs to prevent explore page 404 errors
      const keysToDelete = Object.keys(conversationIdInfo)
      if (keysToDelete.length > 0) {
        keysToDelete.forEach(key => {
          delete conversationIdInfo[key]
          console.log(`🧹 Cleared conversation ID for ${key} to prevent 404 errors`)
        })
        cleared = true
      }
      
      if (cleared) {
        localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify(conversationIdInfo))
        window.dispatchEvent(new StorageEvent('storage', {
          key: CONVERSATION_ID_INFO,
          newValue: JSON.stringify(conversationIdInfo),
          storageArea: localStorage
        }))
      }
    }

    // Clear SWR caches
    await Promise.all([
      mutate(`/apps/${appId}/chat-conversations`),
      mutate(`/apps/${appId}/completion-conversations`),
      mutate(
        key =>
          typeof key === 'string' && key.includes('/explore/apps'),
        undefined,
        { revalidate: false },
      ),
    ])

    console.log(`✅ Cleared chat conversations for app: ${appId}`)
    return result
  }
  catch (error) {
    console.error('Failed to clear chat conversations:', error)
    throw error
  }
}

// Clear completion conversations (all or selected)
export const clearCompletionConversations = async ({ appId, conversationIds }: { appId: string; conversationIds?: string[] }) => {
  try {
    const body = conversationIds ? { conversation_ids: conversationIds } : {}
    const result = await del<any>(`/apps/${appId}/completion-conversations`, { body })

    // Clear localStorage to prevent 404 errors on explore pages
    if (typeof window !== 'undefined') {
      const conversationIdInfo = JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO) || '{}')
      
      // Clear conversation ID for the current app (from logs page)
      let cleared = false
      if (conversationIdInfo[appId]) {
        delete conversationIdInfo[appId]
        cleared = true
        console.log(`✅ Cleared conversation ID info for app ${appId}`)
      }
      
      // ADDITIONAL FIX: Also clear ALL conversation IDs to prevent explore page 404 errors
      const keysToDelete = Object.keys(conversationIdInfo)
      if (keysToDelete.length > 0) {
        keysToDelete.forEach(key => {
          delete conversationIdInfo[key]
          console.log(`🧹 Cleared conversation ID for ${key} to prevent 404 errors`)
        })
        cleared = true
      }
      
      if (cleared) {
        localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify(conversationIdInfo))
        window.dispatchEvent(new StorageEvent('storage', {
          key: CONVERSATION_ID_INFO,
          newValue: JSON.stringify(conversationIdInfo),
          storageArea: localStorage
        }))
      }
    }

    // Clear SWR caches
    await Promise.all([
      mutate(`/apps/${appId}/chat-conversations`),
      mutate(`/apps/${appId}/completion-conversations`),
      mutate(
        key =>
          typeof key === 'string' && key.includes('/explore/apps'),
        undefined,
        { revalidate: false },
      ),
    ])

    console.log(`✅ Cleared completion conversations for app: ${appId}`)
    return result
  }
  catch (error) {
    console.error('Failed to clear completion conversations:', error)
    throw error
  }
}
