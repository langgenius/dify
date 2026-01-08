import type {
  AnnotationsCountResponse,
  ChatConversationFullDetailResponse,
  ChatConversationsRequest,
  ChatConversationsResponse,
  CompletionConversationFullDetailResponse,
  CompletionConversationsRequest,
  CompletionConversationsResponse,
  WorkflowLogExportTaskStatus,
  WorkflowLogsResponse,
} from '@/models/log'
import { useMutation, useQuery } from '@tanstack/react-query'
import { get, post } from './base'

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

export const useWorkflowArchivedLogs = ({ appId, params }: WorkflowLogsParams) => {
  return useQuery<WorkflowLogsResponse>({
    queryKey: [NAME_SPACE, 'workflow-archived-logs', appId, params],
    queryFn: () => get<WorkflowLogsResponse>(`/apps/${appId}/workflow-archived-logs`, { params }),
    enabled: !!appId,
  })
}

// ============ Workflow Run Export Tasks ============

export const useCreateWorkflowRunExportTask = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'workflow-run-export-task', 'create'],
    mutationFn: ({ appId, runId }: { appId: string, runId: string }) =>
      post<WorkflowLogExportTaskStatus>(`/apps/${appId}/workflow-runs/${runId}/export-task`, {}),
  })
}

export const useWorkflowRunExportTaskStatus = (taskId: string, enabled: boolean) => {
  return useQuery<WorkflowLogExportTaskStatus>({
    queryKey: [NAME_SPACE, 'workflow-run-export-task', taskId],
    queryFn: () => get<WorkflowLogExportTaskStatus>(`/workflow-run-export-tasks/${taskId}`),
    enabled: enabled && !!taskId,
    refetchInterval: (query) => {
      const data = query.state.data
      return data && (data.status === 'success' || data.status === 'failed') ? false : 2000
    },
  })
}
