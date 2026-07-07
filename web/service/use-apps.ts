import type { AppPagination, AppPartial } from '@dify/contracts/api/console/apps/types.gen'
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
import type { App, AppIconType } from '@/types/app'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { AccessMode } from '@/models/access-control'
import { consoleClient, consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { get, post } from './base'

const NAME_SPACE = 'apps'

type DateRangeParams = {
  start?: string
  end?: string
}

export const appDetailQueryKeyPrefix = [NAME_SPACE, 'detail']
const useAppFullListKey = [NAME_SPACE, 'full-list']
const appIconTypes = new Set<string>(['emoji', 'image', 'link'])
const appModes = new Set<string>(Object.values(AppModeEnum))
const accessModes = new Set<string>(Object.values(AccessMode))

function isAppIconType(iconType: string | null | undefined): iconType is AppIconType {
  return !!iconType && appIconTypes.has(iconType)
}

function isAppMode(mode: string | null | undefined): mode is AppModeEnum {
  return !!mode && appModes.has(mode)
}

function isAccessMode(accessMode: string | null | undefined): accessMode is AccessMode {
  return !!accessMode && accessModes.has(accessMode)
}

function normalizeWorkflow(workflow: AppPartial['workflow']): App['workflow'] {
  if (!workflow)
    return undefined

  return {
    id: workflow.id,
    created_at: workflow.created_at ?? 0,
    created_by: workflow.created_by ?? undefined,
    updated_at: workflow.updated_at ?? 0,
    updated_by: workflow.updated_by ?? undefined,
  }
}

function normalizeAppListItem(app: AppPartial): App {
  const modelConfig = (app.model_config ?? {}) as App['model_config']

  return {
    id: app.id,
    name: app.name,
    description: app.description ?? '',
    author_name: app.author_name ?? '',
    icon_type: isAppIconType(app.icon_type) ? app.icon_type : null,
    icon: app.icon ?? '',
    icon_background: app.icon_background ?? null,
    icon_url: app.icon_url,
    use_icon_as_answer_icon: app.use_icon_as_answer_icon ?? false,
    mode: isAppMode(app.mode) ? app.mode : AppModeEnum.CHAT,
    enable_site: false,
    enable_api: false,
    api_rpm: 60,
    api_rph: 3600,
    is_demo: false,
    is_starred: app.is_starred,
    model_config: modelConfig,
    app_model_config: modelConfig,
    created_at: app.created_at ?? 0,
    created_by: app.created_by ?? undefined,
    maintainer: app.maintainer ?? undefined,
    updated_at: app.updated_at ?? 0,
    site: {} as App['site'],
    api_base_url: '',
    tags: app.tags ?? [],
    workflow: normalizeWorkflow(app.workflow),
    deleted_tools: [],
    access_mode: isAccessMode(app.access_mode) ? app.access_mode : AccessMode.PUBLIC,
    max_active_requests: app.max_active_requests,
    has_draft_trigger: app.has_draft_trigger ?? undefined,
    workflow_kind: null,
    permission_keys: app.permission_keys,
  }
}

export function normalizeAppPagination(response: AppPagination): AppListResponse {
  return {
    ...response,
    data: response.data.map(normalizeAppListItem),
  }
}

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
    queryKey: [...appDetailQueryKeyPrefix, appID],
    queryFn: () => get<App>(`/apps/${appID}`),
    enabled: !!appID,
    gcTime: 0,
  })
}

export const useInvalidateAppList = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.get.key(),
    })
  }
}

export const useDeleteAppMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: consoleQuery.apps.byAppId.delete.mutationKey(),
    mutationFn: (appId: string) => {
      return consoleClient.apps.byAppId.delete({
        params: { app_id: appId },
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: useAppFullListKey,
        }),
      ])
    },
  })
}

export const useToggleAppStarMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ appId, isStarred }: { appId: string, isStarred: boolean }) => {
      return isStarred
        ? consoleClient.apps.byAppId.star.delete({
            params: { app_id: appId },
          })
        : consoleClient.apps.byAppId.star.post({
            params: { app_id: appId },
          })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.starred.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: useAppFullListKey,
        }),
      ])
    },
  })
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
