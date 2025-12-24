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
  WorkflowLogsResponse,
} from '@/models/log'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from './base'
import { useInvalid } from './use-base'

const NAME_SPACE = 'log'

// ============ Annotations Count ============

export const useAnnotationsCount = (appId: string) => {
  return useQuery<AnnotationsCountResponse>({
    queryKey: [NAME_SPACE, 'annotations-count', appId],
    queryFn: () => get<AnnotationsCountResponse>(`/apps/${appId}/annotations/count`),
    enabled: !!appId,
  })
}

export const useInvalidateAnnotationsCount = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'annotations-count', appId],
    })
  }
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

export const useInvalidateChatConversations = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'chat-conversations', appId],
    })
  }
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

export const useInvalidateCompletionConversations = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'completion-conversations', appId],
    })
  }
}

// ============ Chat Conversation Detail ============

export const useChatConversationDetail = (appId?: string, conversationId?: string) => {
  return useQuery<ChatConversationFullDetailResponse>({
    queryKey: [NAME_SPACE, 'chat-conversation-detail', appId, conversationId],
    queryFn: () => get<ChatConversationFullDetailResponse>(`/apps/${appId}/chat-conversations/${conversationId}`),
    enabled: !!appId && !!conversationId,
  })
}

export const useInvalidateChatConversationDetail = () => {
  return useInvalid([NAME_SPACE, 'chat-conversation-detail'])
}

// ============ Completion Conversation Detail ============

export const useCompletionConversationDetail = (appId?: string, conversationId?: string) => {
  return useQuery<CompletionConversationFullDetailResponse>({
    queryKey: [NAME_SPACE, 'completion-conversation-detail', appId, conversationId],
    queryFn: () => get<CompletionConversationFullDetailResponse>(`/apps/${appId}/completion-conversations/${conversationId}`),
    enabled: !!appId && !!conversationId,
  })
}

export const useInvalidateCompletionConversationDetail = () => {
  const queryClient = useQueryClient()
  return (appId: string, conversationId: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'completion-conversation-detail', appId, conversationId],
    })
  }
}

// ============ Chat Messages ============

export const useChatMessages = (appId?: string, params?: ChatMessagesRequest) => {
  return useQuery<ChatMessagesResponse>({
    queryKey: [NAME_SPACE, 'chat-messages', appId, params],
    queryFn: () => get<ChatMessagesResponse>(`/apps/${appId}/chat-messages`, { params }),
    enabled: !!appId && !!params?.conversation_id,
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

export const useInvalidateWorkflowLogs = () => {
  const queryClient = useQueryClient()
  return (appId: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'workflow-logs', appId],
    })
  }
}
