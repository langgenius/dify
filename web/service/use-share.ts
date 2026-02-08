import type { AppConversationData, ConversationItem } from '@/models/share'
import { useQuery } from '@tanstack/react-query'
import {
  AppSourceType,
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  generationConversationName,
  getAppAccessModeByAppCode,
} from './share'
import { useInvalid } from './use-base'

const NAME_SPACE = 'webapp'

type ShareConversationsParams = {
  appSourceType: AppSourceType
  appId?: string
  lastId?: string
  pinned?: boolean
  limit?: number
}

type ShareChatListParams = {
  conversationId: string
  appSourceType: AppSourceType
  appId?: string
}

type ShareConversationNameParams = {
  conversationId: string
  appSourceType: AppSourceType
  appId?: string
}

type ShareQueryOptions = {
  enabled?: boolean
  refetchOnWindowFocus?: boolean
  refetchOnReconnect?: boolean
}

export const shareQueryKeys = {
  appAccessMode: (code: string | null) => [NAME_SPACE, 'appAccessMode', code] as const,
  appInfo: [NAME_SPACE, 'appInfo'] as const,
  appParams: [NAME_SPACE, 'appParams'] as const,
  appMeta: [NAME_SPACE, 'appMeta'] as const,
  conversations: [NAME_SPACE, 'conversations'] as const,
  conversationList: (params: ShareConversationsParams) => [NAME_SPACE, 'conversations', params] as const,
  chatList: (params: ShareChatListParams) => [NAME_SPACE, 'chatList', params] as const,
  conversationName: (params: ShareConversationNameParams) => [NAME_SPACE, 'conversationName', params] as const,
}

export const useGetWebAppAccessModeByCode = (code: string | null) => {
  return useQuery({
    queryKey: shareQueryKeys.appAccessMode(code),
    queryFn: () => getAppAccessModeByAppCode(code!),
    enabled: !!code,
    staleTime: 0, // backend change the access mode may cause the logic error. Because /permission API is no cached.
    gcTime: 0,
  })
}

export const useGetWebAppInfo = () => {
  return useQuery({
    queryKey: shareQueryKeys.appInfo,
    queryFn: () => {
      return fetchAppInfo()
    },
  })
}

export const useGetWebAppParams = () => {
  return useQuery({
    queryKey: shareQueryKeys.appParams,
    queryFn: () => {
      return fetchAppParams(AppSourceType.webApp)
    },
  })
}

export const useGetWebAppMeta = () => {
  return useQuery({
    queryKey: shareQueryKeys.appMeta,
    queryFn: () => {
      return fetchAppMeta(AppSourceType.webApp)
    },
  })
}

export const useShareConversations = (params: ShareConversationsParams, options: ShareQueryOptions = {}) => {
  const {
    enabled = true,
    refetchOnReconnect,
    refetchOnWindowFocus,
  } = options
  const isEnabled = enabled && params.appSourceType !== AppSourceType.tryApp && (params.appSourceType !== AppSourceType.installedApp || !!params.appId)
  return useQuery<AppConversationData>({
    queryKey: shareQueryKeys.conversationList(params),
    queryFn: () => fetchConversations(
      params.appSourceType,
      params.appId,
      params.lastId,
      params.pinned,
      params.limit,
    ),
    enabled: isEnabled,
    refetchOnReconnect,
    refetchOnWindowFocus,
  })
}

export const useShareChatList = (params: ShareChatListParams, options: ShareQueryOptions = {}) => {
  const {
    enabled = true,
    refetchOnReconnect,
    refetchOnWindowFocus,
  } = options
  const isEnabled = enabled && params.appSourceType !== AppSourceType.tryApp && (params.appSourceType !== AppSourceType.installedApp || !!params.appId) && !!params.conversationId
  return useQuery({
    queryKey: shareQueryKeys.chatList(params),
    queryFn: () => fetchChatList(params.conversationId, params.appSourceType, params.appId),
    enabled: isEnabled,
    refetchOnReconnect,
    refetchOnWindowFocus,
    // Always consider chat list data stale to ensure fresh data when switching
    // back to a conversation. This fixes issue where recent messages don't appear
    // until switching away and back again (GitHub issue #30378).
    staleTime: 0,
  })
}

export const useShareConversationName = (params: ShareConversationNameParams, options: ShareQueryOptions = {}) => {
  const {
    enabled = true,
    refetchOnReconnect,
    refetchOnWindowFocus,
  } = options
  const isEnabled = enabled && (params.appSourceType !== AppSourceType.installedApp || !!params.appId) && !!params.conversationId
  return useQuery<ConversationItem>({
    queryKey: shareQueryKeys.conversationName(params),
    queryFn: () => generationConversationName(params.appSourceType, params.appId, params.conversationId),
    enabled: isEnabled,
    refetchOnReconnect,
    refetchOnWindowFocus,
  })
}

export const useInvalidateShareConversations = () => {
  return useInvalid(shareQueryKeys.conversations)
}
