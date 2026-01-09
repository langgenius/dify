import type {
  AnnotationsCountResponse,
  ChatConversationFullDetailResponse,
  ChatConversationsRequest,
  ChatConversationsResponse,
  CompletionConversationFullDetailResponse,
  CompletionConversationsRequest,
  CompletionConversationsResponse,
  WorkflowLogsResponse,
} from '@/models/log'
import { useQuery } from '@tanstack/react-query'
import Cookies from 'js-cookie'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { get } from './base'
import { getBaseOptions } from './fetch'

const NAME_SPACE = 'log'

// ============ Annotations Count ============

export const useAnnotationsCount = (appId: string) => {
  return useQuery<AnnotationsCountResponse>({
    queryKey: [NAME_SPACE, 'annotations-count', appId],
    queryFn: () => get<AnnotationsCountResponse>(`/apps/${appId}/annotations/count`),
    enabled: !!appId,
  })
}

// ============ Chat Conversations ============

type ChatConversationsParams = {
  appId: string
  params?: Partial<ChatConversationsRequest>
}

export const useChatConversations = ({ appId, params }: ChatConversationsParams) => {
  return useQuery<ChatConversationsResponse>({
    queryKey: [NAME_SPACE, 'chat-conversations', appId, params],
    queryFn: () => get<ChatConversationsResponse>(`/apps/${appId}/chat-conversations`, { params }),
    enabled: !!appId,
  })
}

// ============ Completion Conversations ============

type CompletionConversationsParams = {
  appId: string
  params?: Partial<CompletionConversationsRequest>
}

export const useCompletionConversations = ({ appId, params }: CompletionConversationsParams) => {
  return useQuery<CompletionConversationsResponse>({
    queryKey: [NAME_SPACE, 'completion-conversations', appId, params],
    queryFn: () => get<CompletionConversationsResponse>(`/apps/${appId}/completion-conversations`, { params }),
    enabled: !!appId,
  })
}

// ============ Chat Conversation Detail ============

export const useChatConversationDetail = (appId?: string, conversationId?: string) => {
  return useQuery<ChatConversationFullDetailResponse>({
    queryKey: [NAME_SPACE, 'chat-conversation-detail', appId, conversationId],
    queryFn: () => get<ChatConversationFullDetailResponse>(`/apps/${appId}/chat-conversations/${conversationId}`),
    enabled: !!appId && !!conversationId,
  })
}

// ============ Completion Conversation Detail ============

export const useCompletionConversationDetail = (appId?: string, conversationId?: string) => {
  return useQuery<CompletionConversationFullDetailResponse>({
    queryKey: [NAME_SPACE, 'completion-conversation-detail', appId, conversationId],
    queryFn: () => get<CompletionConversationFullDetailResponse>(`/apps/${appId}/completion-conversations/${conversationId}`),
    enabled: !!appId && !!conversationId,
  })
}

// ============ Workflow Logs ============

type WorkflowLogsParams = {
  appId: string
  params?: Record<string, string | number | boolean | undefined>
}

export const useWorkflowLogs = ({ appId, params }: WorkflowLogsParams) => {
  return useQuery<WorkflowLogsResponse>({
    queryKey: [NAME_SPACE, 'workflow-logs', appId, params],
    queryFn: () => get<WorkflowLogsResponse>(`/apps/${appId}/workflow-app-logs`, { params }),
    enabled: !!appId,
  })
}

// ============ Export Conversations ============

export const exportChatConversations = async (
  appId: string,
  format: 'jsonl' | 'csv' = 'jsonl',
  filters?: {
    keyword?: string
    start?: string
    end?: string
    annotation_status?: string
    sort_by?: string
  },
) => {
  const baseOptions = getBaseOptions()
  const params = new URLSearchParams({ format })

  if (filters?.keyword)
    params.append('keyword', filters.keyword)
  if (filters?.start)
    params.append('start', filters.start)
  if (filters?.end)
    params.append('end', filters.end)
  if (filters?.annotation_status)
    params.append('annotation_status', filters.annotation_status)
  if (filters?.sort_by)
    params.append('sort_by', filters.sort_by)

  const url = `${API_PREFIX}/apps/${appId}/chat-conversations/export?${params.toString()}`

  const response = await fetch(url, {
    ...baseOptions,
    method: 'GET',
    headers: new Headers({
      ...((baseOptions.headers as Headers) ?? {}),
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Export failed')
  }

  // Get filename from Content-Disposition header
  const contentDisposition = response.headers.get('Content-Disposition')
  let filename = `conversations_export.${format}`
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/)
    if (filenameMatch)
      filename = filenameMatch[1]
  }

  // Create download link
  const blob = await response.blob()
  const url_blob = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url_blob
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url_blob)
}
