import type { WebAppAddress } from './webapp-address'
import type { LegacyHumanInputFormData as HumanInputFormData } from '@/features/human-input/form/types'
import type { AppConversationData, ConversationItem } from '@/models/share'
import { ORPCError } from '@orpc/client'
import { mutationOptions, queryOptions, skipToken } from '@tanstack/react-query'
import {
  AppSourceType,
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
  fetchConversations,
  generationConversationName,
  getAppAccessModeByAppCode,
  getHumanInputForm,
  submitHumanInputForm,
} from './share'
import { resolveWebAppAddress } from './webapp-address'

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

export class EnvironmentConversationNotFoundError extends Error {
  constructor() {
    super('Environment conversation not found')
    this.name = 'EnvironmentConversationNotFoundError'
  }
}

export const shareQueryKeys = {
  appAccessMode: (address: WebAppAddress | null, code: string | null) =>
    [NAME_SPACE, 'appAccessMode', address, code] as const,
  appInfo: (address: WebAppAddress | null) => [NAME_SPACE, address, 'appInfo'] as const,
  appParams: (address: WebAppAddress | null) => [NAME_SPACE, address, 'appParams'] as const,
  appMeta: (address: WebAppAddress | null) => [NAME_SPACE, address, 'appMeta'] as const,
  conversations: [NAME_SPACE, 'conversations'] as const,
  conversationList: (address: WebAppAddress | null, params: ShareConversationsParams) =>
    [NAME_SPACE, 'conversations', address, params] as const,
  chatList: (address: WebAppAddress | null, params: ShareChatListParams) =>
    [NAME_SPACE, 'chatList', address, params] as const,
  conversationName: (address: WebAppAddress | null, params: ShareConversationNameParams) =>
    [NAME_SPACE, 'conversationName', address, params] as const,
  humanInputForm: (token: string) => [NAME_SPACE, 'humanInputForm', token] as const,
}

export const webAppAccessModeQueryOptions = (code: string | null) =>
  queryOptions({
    queryKey: shareQueryKeys.appAccessMode(resolveWebAppAddress(), code),
    queryFn: code ? () => getAppAccessModeByAppCode(code) : skipToken,
    staleTime: 0, // backend change the access mode may cause the logic error. Because /permission API is no cached.
    gcTime: 0,
  })

export const webAppInfoQueryOptions = () =>
  queryOptions({
    queryKey: shareQueryKeys.appInfo(resolveWebAppAddress()),
    queryFn: () => fetchAppInfo(),
  })

export const webAppParamsQueryOptions = () =>
  queryOptions({
    queryKey: shareQueryKeys.appParams(resolveWebAppAddress()),
    queryFn: () => fetchAppParams(AppSourceType.webApp),
  })

export const webAppMetaQueryOptions = () =>
  queryOptions({
    queryKey: shareQueryKeys.appMeta(resolveWebAppAddress()),
    queryFn: () => fetchAppMeta(AppSourceType.webApp),
  })

export const shareConversationsQueryOptions = (
  params: ShareConversationsParams,
  options: ShareQueryOptions = {},
) => {
  const { enabled = true, refetchOnReconnect, refetchOnWindowFocus } = options
  return queryOptions<AppConversationData>({
    queryKey: shareQueryKeys.conversationList(resolveWebAppAddress(), params),
    queryFn: () =>
      fetchConversations(
        params.appSourceType,
        params.appId,
        params.lastId,
        params.pinned,
        params.limit,
      ),
    enabled:
      enabled &&
      params.appSourceType !== AppSourceType.tryApp &&
      (params.appSourceType !== AppSourceType.installedApp || !!params.appId),
    refetchOnReconnect,
    refetchOnWindowFocus,
  })
}

export const shareChatListQueryOptions = (
  params: ShareChatListParams,
  options: ShareQueryOptions = {},
) => {
  const address = resolveWebAppAddress()
  const { enabled = true, refetchOnReconnect, refetchOnWindowFocus } = options
  return queryOptions({
    queryKey: shareQueryKeys.chatList(address, params),
    queryFn: async () => {
      try {
        return await fetchChatList(params.conversationId, params.appSourceType, params.appId)
      } catch (error) {
        if (address?.kind === 'environment' && error instanceof ORPCError && error.status === 404) {
          if (error.data?.reason === 'APPDEPLOY_CONVERSATION_NOT_FOUND')
            throw new EnvironmentConversationNotFoundError()
        }
        throw error
      }
    },
    enabled:
      enabled &&
      params.appSourceType !== AppSourceType.tryApp &&
      (params.appSourceType !== AppSourceType.installedApp || !!params.appId) &&
      !!params.conversationId,
    refetchOnReconnect,
    refetchOnWindowFocus,
    // Always consider chat list data stale to ensure fresh data when switching
    // back to a conversation. This fixes issue where recent messages don't appear
    // until switching away and back again (GitHub issue #30378).
    staleTime: 0,
  })
}

export const shareConversationNameQueryOptions = (
  params: ShareConversationNameParams,
  options: ShareQueryOptions = {},
) => {
  const { enabled = true, refetchOnReconnect, refetchOnWindowFocus } = options
  return queryOptions<ConversationItem>({
    queryKey: shareQueryKeys.conversationName(resolveWebAppAddress(), params),
    queryFn: () =>
      generationConversationName(params.appSourceType, params.appId, params.conversationId),
    enabled:
      enabled &&
      (params.appSourceType !== AppSourceType.installedApp || !!params.appId) &&
      !!params.conversationId,
    refetchOnReconnect,
    refetchOnWindowFocus,
  })
}

export const humanInputFormQueryOptions = (token: string) =>
  queryOptions<HumanInputFormData>({
    queryKey: shareQueryKeys.humanInputForm(token),
    queryFn: () => getHumanInputForm(token),
    enabled: !!token,
    retry: false,
  })

type SubmitHumanInputFormParams = {
  token: string
  data: {
    inputs: Record<string, unknown>
    action: string
  }
}

export const submitHumanInputFormMutationOptions = () =>
  mutationOptions({
    mutationKey: [NAME_SPACE, 'submit-human-input-form'],
    mutationFn: ({ token, data }: SubmitHumanInputFormParams) => submitHumanInputForm(token, data),
  })
