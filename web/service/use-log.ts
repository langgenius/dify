import type { QueryMeta } from '@tanstack/react-query'
import type {
  ChatConversationFullDetailResponse,
  ChatConversationsRequest,
  ChatConversationsResponse,
  CompletionConversationFullDetailResponse,
  CompletionConversationsRequest,
  CompletionConversationsResponse,
  WorkflowLogsResponse,
  WorkflowPausedDetailsResponse,
} from '@/models/log'
import { useQuery } from '@tanstack/react-query'
import { consoleClient } from '@/service/console'
import { get } from './base'

const NAME_SPACE = 'log'

// ============ Annotations Count ============

export const useAnnotationsCount = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'annotations-count', appId],
    queryFn: () =>
      consoleClient.apps.byAppId.annotations.count.get({
        params: {
          app_id: appId,
        },
      }),
    enabled: !!appId,
  })
}

// ============ Chat Conversations ============

type ChatConversationsParams = {
  appId: string
  params?: Partial<ChatConversationsRequest>
  meta?: QueryMeta
}

export const useChatConversations = ({ appId, params, meta }: ChatConversationsParams) => {
  return useQuery<ChatConversationsResponse>({
    meta,
    queryKey: [NAME_SPACE, 'chat-conversations', appId, params],
    queryFn: () => get<ChatConversationsResponse>(`/apps/${appId}/chat-conversations`, { params }),
    enabled: !!appId,
  })
}

// ============ Completion Conversations ============

type CompletionConversationsParams = {
  appId: string
  params?: Partial<CompletionConversationsRequest>
  meta?: QueryMeta
}

export const useCompletionConversations = ({
  appId,
  params,
  meta,
}: CompletionConversationsParams) => {
  return useQuery<CompletionConversationsResponse>({
    meta,
    queryKey: [NAME_SPACE, 'completion-conversations', appId, params],
    queryFn: () =>
      get<CompletionConversationsResponse>(`/apps/${appId}/completion-conversations`, { params }),
    enabled: !!appId,
  })
}

// ============ Chat Conversation Detail ============

export const useChatConversationDetail = (
  appId?: string,
  conversationId?: string,
  { meta }: { meta?: QueryMeta } = {},
) => {
  return useQuery<ChatConversationFullDetailResponse>({
    meta,
    queryKey: [NAME_SPACE, 'chat-conversation-detail', appId, conversationId],
    queryFn: () =>
      get<ChatConversationFullDetailResponse>(
        `/apps/${appId}/chat-conversations/${conversationId}`,
      ),
    enabled: !!appId && !!conversationId,
  })
}

// ============ Completion Conversation Detail ============

export const useCompletionConversationDetail = (
  appId?: string,
  conversationId?: string,
  { meta }: { meta?: QueryMeta } = {},
) => {
  return useQuery<CompletionConversationFullDetailResponse>({
    meta,
    queryKey: [NAME_SPACE, 'completion-conversation-detail', appId, conversationId],
    queryFn: () =>
      get<CompletionConversationFullDetailResponse>(
        `/apps/${appId}/completion-conversations/${conversationId}`,
      ),
    enabled: !!appId && !!conversationId,
  })
}

// ============ Workflow Logs ============

type WorkflowLogsParams = {
  appId: string
  params?: Record<string, string | number | boolean | undefined>
  meta?: QueryMeta
}

export const useWorkflowLogs = ({ appId, params, meta }: WorkflowLogsParams) => {
  return useQuery<WorkflowLogsResponse>({
    meta,
    queryKey: [NAME_SPACE, 'workflow-logs', appId, params],
    queryFn: () => get<WorkflowLogsResponse>(`/apps/${appId}/workflow-app-logs`, { params }),
    enabled: !!appId,
  })
}

// ============ Workflow Pause Details ============

type WorkflowPausedDetailsParams = {
  workflowRunId: string
  enabled?: boolean
}

export const useWorkflowPausedDetails = ({
  workflowRunId,
  enabled = true,
}: WorkflowPausedDetailsParams) => {
  return useQuery<WorkflowPausedDetailsResponse>({
    queryKey: [NAME_SPACE, 'workflow-paused-details', workflowRunId],
    queryFn: () => get<WorkflowPausedDetailsResponse>(`/workflow/${workflowRunId}/pause-details`),
    enabled: enabled && !!workflowRunId,
  })
}
