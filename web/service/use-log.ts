import type { QueryKey } from '@tanstack/react-query'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  fetchAnnotationsCount,
  fetchChatConversationDetail,
  fetchChatConversations,
  fetchCompletionConversationDetail,
  fetchCompletionConversations,
  updateLogMessageAnnotations,
  updateLogMessageFeedbacks,
} from '@/service/log'
import type {
  AnnotationsCountResponse,
  ChatConversationFullDetailResponse,
  ChatConversationsRequest,
  ChatConversationsResponse,
  CompletionConversationFullDetailResponse,
  CompletionConversationsRequest,
  CompletionConversationsResponse,
  MessageRating,
} from '@/models/log'

type FeedbackPayload = {
  mid: string
  rating: MessageRating
  content?: string | null
}

type AnnotationPayload = {
  mid: string
  value: string
}

type ChatConversationsParams = Partial<ChatConversationsRequest> & { sort_by?: string }
type CompletionConversationsParams = Partial<CompletionConversationsRequest> & { sort_by?: string }

export const chatConversationsKey = (appId?: string, params?: ChatConversationsParams): QueryKey => ['chat-conversations', appId, params]
export const completionConversationsKey = (appId?: string, params?: CompletionConversationsParams): QueryKey => ['completion-conversations', appId, params]
export const completionConversationDetailKey = (appId?: string, conversationId?: string): QueryKey => ['completion-conversation-detail', appId, conversationId]

export const chatConversationDetailKey = (appId?: string, conversationId?: string): QueryKey => ['chat-conversation-detail', appId, conversationId]

export const annotationsCountKey = (appId?: string): QueryKey => ['annotations-count', appId]

export const useChatConversations = (appId?: string, params?: ChatConversationsParams, enabled = true) => {
  const queryKey = chatConversationsKey(appId, params)
  const queryResult = useQuery<ChatConversationsResponse>({
    queryKey,
    queryFn: () => fetchChatConversations({ url: `/apps/${appId}/chat-conversations`, params }),
    enabled: Boolean(appId && enabled),
  })

  return { ...queryResult, queryKey }
}

export const useCompletionConversations = (appId?: string, params?: CompletionConversationsParams, enabled = true) => {
  const queryKey = completionConversationsKey(appId, params)
  const queryResult = useQuery<CompletionConversationsResponse>({
    queryKey,
    queryFn: () => fetchCompletionConversations({ url: `/apps/${appId}/completion-conversations`, params }),
    enabled: Boolean(appId && enabled),
  })

  return { ...queryResult, queryKey }
}

export const useAnnotationsCount = (appId?: string) => {
  const queryKey = annotationsCountKey(appId)
  const queryResult = useQuery<AnnotationsCountResponse>({
    queryKey,
    queryFn: () => fetchAnnotationsCount({ url: `/apps/${appId}/annotations/count` }),
    enabled: Boolean(appId),
  })

  return { ...queryResult, queryKey }
}

export const useCompletionConversationDetail = (appId?: string, conversationId?: string) => {
  const queryKey = completionConversationDetailKey(appId, conversationId)
  const queryResult = useQuery<CompletionConversationFullDetailResponse>({
    queryKey,
    queryFn: () => fetchCompletionConversationDetail({ url: `/apps/${appId}/completion-conversations/${conversationId}` }),
    enabled: Boolean(appId && conversationId),
  })

  return { ...queryResult, queryKey }
}

export const useChatConversationDetail = (appId?: string, conversationId?: string) => {
  const queryKey = chatConversationDetailKey(appId, conversationId)
  const queryResult = useQuery<ChatConversationFullDetailResponse>({
    queryKey,
    queryFn: () => fetchChatConversationDetail({ url: `/apps/${appId}/chat-conversations/${conversationId}` }),
    enabled: Boolean(appId && conversationId),
  })

  return { ...queryResult, queryKey }
}

export const useUpdateLogMessageFeedback = (appId?: string, invalidateKey?: QueryKey) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ mid, rating, content }: FeedbackPayload) => {
      if (!appId)
        throw new Error('appId is required to update message feedback.')
      return await updateLogMessageFeedbacks({
        url: `/apps/${appId}/feedbacks`,
        body: { message_id: mid, rating, content: content ?? undefined },
      })
    },
    onSuccess: () => {
      if (invalidateKey)
        queryClient.invalidateQueries({ queryKey: invalidateKey })
    },
  })
}

export const useUpdateLogMessageAnnotation = (appId?: string, invalidateKey?: QueryKey) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ mid, value }: AnnotationPayload) => {
      if (!appId)
        throw new Error('appId is required to update message annotation.')
      return await updateLogMessageAnnotations({
        url: `/apps/${appId}/annotations`,
        body: { message_id: mid, content: value },
      })
    },
    onSuccess: () => {
      if (invalidateKey)
        queryClient.invalidateQueries({ queryKey: invalidateKey })
    },
  })
}
