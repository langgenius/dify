import type { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import type {
  ApiKeysListResponse,
  AppDailyConversationsResponse,
  AppDailyEndUsersResponse,
  AppDailyMessagesResponse,
  AppListResponse,
  AppStatisticsResponse,
  AppTokenCostsResponse,
  AppVoicesListResponse,
  WorkflowDailyConversationsResponse,
} from '@/models/app'
import type { App } from '@/types/app'
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { AppModeEnum } from '@/types/app'
import { get, post } from './base'
import { useInvalid } from './use-base'

const NAME_SPACE = 'apps'

type AppListParams = {
  page?: number
  limit?: number
  name?: string
  mode?: AppModeEnum | 'all'
  tag_ids?: string[]
  is_created_by_me?: boolean
}

type DateRangeParams = {
  start?: string
  end?: string
}

// Allowed app modes for filtering; defined at module scope to avoid re-creating on every call
const allowedModes = new Set<AppModeEnum | 'all'>([
  'all',
  AppModeEnum.WORKFLOW,
  AppModeEnum.ADVANCED_CHAT,
  AppModeEnum.CHAT,
  AppModeEnum.AGENT_CHAT,
  AppModeEnum.COMPLETION,
])

const normalizeAppListParams = (params: AppListParams) => {
  const {
    page = 1,
    limit = 30,
    name = '',
    mode,
    tag_ids,
    is_created_by_me,
  } = params

  const safeMode = allowedModes.has((mode as any)) ? mode : undefined

  return {
    page,
    limit,
    name,
    ...(safeMode && safeMode !== 'all' ? { mode: safeMode } : {}),
    ...(tag_ids?.length ? { tag_ids } : {}),
    ...(is_created_by_me ? { is_created_by_me } : {}),
  }
}

const appListKey = (params: AppListParams) => [NAME_SPACE, 'list', params]

const useAppFullListKey = [NAME_SPACE, 'full-list']

export const useGenerateRuleTemplate = (type: GeneratorType, disabled?: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'generate-rule-template', type],
    queryFn: () => post<{ data: string }>('instruction-generate/template', {
      body: {
        type,
      },
    }),
    enabled: !disabled,
    retry: 0,
  })
}

export const useAppDetail = (appID: string) => {
  return useQuery<App>({
    queryKey: [NAME_SPACE, 'detail', appID],
    queryFn: () => get<App>(`/apps/${appID}`),
    enabled: !!appID,
  })
}

export const useAppList = (params: AppListParams, options?: { enabled?: boolean }) => {
  const normalizedParams = normalizeAppListParams(params)
  return useQuery<AppListResponse>({
    queryKey: appListKey(normalizedParams),
    queryFn: () => get<AppListResponse>('/apps', { params: normalizedParams }),
    ...options,
  })
}

export const useAppFullList = () => {
  return useQuery<AppListResponse>({
    queryKey: useAppFullListKey,
    queryFn: () => get<AppListResponse>('/apps', { params: { page: 1, limit: 100, name: '' } }),
  })
}

export const useInvalidateAppFullList = () => {
  return useInvalid(useAppFullListKey)
}

export const useInfiniteAppList = (params: AppListParams, options?: { enabled?: boolean }) => {
  const normalizedParams = normalizeAppListParams(params)
  return useInfiniteQuery<AppListResponse>({
    queryKey: appListKey(normalizedParams),
    queryFn: ({ pageParam = normalizedParams.page }) => get<AppListResponse>('/apps', { params: { ...normalizedParams, page: pageParam } }),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: normalizedParams.page,
    placeholderData: keepPreviousData,
    ...options,
  })
}

export const useInvalidateAppList = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'list'],
    })
  }
}

const useAppStatisticsQuery = <T>(metric: string, appId: string, params?: DateRangeParams) => {
  return useQuery<T>({
    queryKey: [NAME_SPACE, 'statistics', metric, appId, params],
    queryFn: () => get<T>(`/apps/${appId}/statistics/${metric}`, { params }),
    enabled: !!appId,
  })
}

const useWorkflowStatisticsQuery = <T>(metric: string, appId: string, params?: DateRangeParams) => {
  return useQuery<T>({
    queryKey: [NAME_SPACE, 'workflow-statistics', metric, appId, params],
    queryFn: () => get<T>(`/apps/${appId}/workflow/statistics/${metric}`, { params }),
    enabled: !!appId,
  })
}

export const useAppDailyMessages = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppDailyMessagesResponse>('daily-messages', appId, params)
}

export const useAppDailyConversations = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppDailyConversationsResponse>('daily-conversations', appId, params)
}

export const useAppDailyEndUsers = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppDailyEndUsersResponse>('daily-end-users', appId, params)
}

export const useAppAverageSessionInteractions = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppStatisticsResponse>('average-session-interactions', appId, params)
}

export const useAppAverageResponseTime = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppStatisticsResponse>('average-response-time', appId, params)
}

export const useAppTokensPerSecond = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppStatisticsResponse>('tokens-per-second', appId, params)
}

export const useAppSatisfactionRate = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppStatisticsResponse>('user-satisfaction-rate', appId, params)
}

export const useAppTokenCosts = (appId: string, params?: DateRangeParams) => {
  return useAppStatisticsQuery<AppTokenCostsResponse>('token-costs', appId, params)
}

export const useWorkflowDailyConversations = (appId: string, params?: DateRangeParams) => {
  return useWorkflowStatisticsQuery<WorkflowDailyConversationsResponse>('daily-conversations', appId, params)
}

export const useWorkflowDailyTerminals = (appId: string, params?: DateRangeParams) => {
  return useWorkflowStatisticsQuery<AppDailyEndUsersResponse>('daily-terminals', appId, params)
}

export const useWorkflowTokenCosts = (appId: string, params?: DateRangeParams) => {
  return useWorkflowStatisticsQuery<AppTokenCostsResponse>('token-costs', appId, params)
}

export const useWorkflowAverageInteractions = (appId: string, params?: DateRangeParams) => {
  return useWorkflowStatisticsQuery<AppStatisticsResponse>('average-app-interactions', appId, params)
}

export const useAppVoices = (appId?: string, language?: string) => {
  return useQuery<AppVoicesListResponse>({
    queryKey: [NAME_SPACE, 'voices', appId, language || 'en-US'],
    queryFn: () => get<AppVoicesListResponse>(`/apps/${appId}/text-to-audio/voices`, { params: { language: language || 'en-US' } }),
    enabled: !!appId,
  })
}

export const useAppApiKeys = (appId?: string, options?: { enabled?: boolean }) => {
  return useQuery<ApiKeysListResponse>({
    queryKey: [NAME_SPACE, 'api-keys', appId],
    queryFn: () => get<ApiKeysListResponse>(`/apps/${appId}/api-keys`),
    enabled: !!appId && (options?.enabled ?? true),
  })
}

export const useInvalidateAppApiKeys = () => {
  const queryClient = useQueryClient()
  return (appId?: string) => {
    if (!appId)
      return
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'api-keys', appId],
    })
  }
}
