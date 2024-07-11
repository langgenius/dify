import type { Fetcher } from 'swr'
import { del, get, patch, post, put } from './base'
import type { ApikeysListResponse, AppDailyConversationsResponse, AppDailyEndUsersResponse, AppDetailResponse, AppListResponse, AppStatisticsResponse, AppTemplatesResponse, AppTokenCostsResponse, AppVoicesListResponse, CreateApiKeyResponse, GenerationIntroductionResponse, TracingConfig, TracingStatus, UpdateAppModelConfigResponse, UpdateAppSiteCodeResponse, UpdateOpenAIKeyResponse, ValidateOpenAIKeyResponse, WorkflowDailyConversationsResponse } from '@/models/app'
import type { CommonResponse } from '@/models/common'
import type { AppMode, ModelConfig } from '@/types/app'
import type { TracingProvider } from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/type'

export const fetchAppList: Fetcher<AppListResponse, { url: string; params?: Record<string, any> }> = ({ url, params }) => {
  return get<AppListResponse>(url, { params })
}

export const fetchAppDetail = ({ url, id }: { url: string; id: string }) => {
  return get<AppDetailResponse>(`${url}/${id}`)
}

export const fetchAppTemplates: Fetcher<AppTemplatesResponse, { url: string }> = ({ url }) => {
  return get<AppTemplatesResponse>(url)
}

export const createApp: Fetcher<AppDetailResponse, { name: string; icon: string; icon_background: string; mode: AppMode; description?: string; config?: ModelConfig }> = ({ name, icon, icon_background, mode, description, config }) => {
  return post<AppDetailResponse>('apps', { body: { name, icon, icon_background, mode, description, model_config: config } })
}

export const updateAppInfo: Fetcher<AppDetailResponse, { appID: string; name: string; icon: string; icon_background: string; description: string }> = ({ appID, name, icon, icon_background, description }) => {
  return put<AppDetailResponse>(`apps/${appID}`, { body: { name, icon, icon_background, description } })
}

export const copyApp: Fetcher<AppDetailResponse, { appID: string; name: string; icon: string; icon_background: string; mode: AppMode; description?: string }> = ({ appID, name, icon, icon_background, mode, description }) => {
  return post<AppDetailResponse>(`apps/${appID}/copy`, { body: { name, icon, icon_background, mode, description } })
}

export const exportAppConfig: Fetcher<{ data: string }, string> = (appID) => {
  return get<{ data: string }>(`apps/${appID}/export`)
}

export const importApp: Fetcher<AppDetailResponse, { data: string; name?: string; description?: string; icon?: string; icon_background?: string }> = ({ data, name, description, icon, icon_background }) => {
  return post<AppDetailResponse>('apps/import', { body: { data, name, description, icon, icon_background } })
}

export const switchApp: Fetcher<{ new_app_id: string }, { appID: string; name: string; icon: string; icon_background: string }> = ({ appID, name, icon, icon_background }) => {
  return post<{ new_app_id: string }>(`apps/${appID}/convert-to-workflow`, { body: { name, icon, icon_background } })
}

export const deleteApp: Fetcher<CommonResponse, string> = (appID) => {
  return del<CommonResponse>(`apps/${appID}`)
}

export const updateAppSiteStatus: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<AppDetailResponse>(url, { body })
}

export const updateAppApiStatus: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<AppDetailResponse>(url, { body })
}

// path: /apps/{appId}/rate-limit
export const updateAppRateLimit: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<AppDetailResponse>(url, { body })
}

export const updateAppSiteAccessToken: Fetcher<UpdateAppSiteCodeResponse, { url: string }> = ({ url }) => {
  return post<UpdateAppSiteCodeResponse>(url)
}

export const updateAppSiteConfig = ({ url, body }: { url: string; body: Record<string, any> }) => {
  return post<AppDetailResponse>(url, { body })
}

export const getAppDailyConversations: Fetcher<AppDailyConversationsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<AppDailyConversationsResponse>(url, { params })
}

export const getWorkflowDailyConversations: Fetcher<WorkflowDailyConversationsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<WorkflowDailyConversationsResponse>(url, { params })
}

export const getAppStatistics: Fetcher<AppStatisticsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<AppStatisticsResponse>(url, { params })
}

export const getAppDailyEndUsers: Fetcher<AppDailyEndUsersResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<AppDailyEndUsersResponse>(url, { params })
}

export const getAppTokenCosts: Fetcher<AppTokenCostsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<AppTokenCostsResponse>(url, { params })
}

export const updateAppModelConfig: Fetcher<UpdateAppModelConfigResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<UpdateAppModelConfigResponse>(url, { body })
}

// For temp testing
export const fetchAppListNoMock: Fetcher<AppListResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<AppListResponse>(url, params)
}

export const fetchApiKeysList: Fetcher<ApikeysListResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<ApikeysListResponse>(url, params)
}

export const delApikey: Fetcher<CommonResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return del<CommonResponse>(url, params)
}

export const createApikey: Fetcher<CreateApiKeyResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<CreateApiKeyResponse>(url, body)
}

export const validateOpenAIKey: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post<ValidateOpenAIKeyResponse>(url, { body })
}

export const updateOpenAIKey: Fetcher<UpdateOpenAIKeyResponse, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post<UpdateOpenAIKeyResponse>(url, { body })
}

export const generationIntroduction: Fetcher<GenerationIntroductionResponse, { url: string; body: { prompt_template: string } }> = ({ url, body }) => {
  return post<GenerationIntroductionResponse>(url, { body })
}

export const fetchAppVoices: Fetcher<AppVoicesListResponse, { appId: string; language?: string }> = ({ appId, language }) => {
  language = language || 'en-US'
  return get<AppVoicesListResponse>(`apps/${appId}/text-to-audio/voices?language=${language}`)
}

// Tracing
export const fetchTracingStatus: Fetcher<TracingStatus, { appId: string }> = ({ appId }) => {
  return get(`/apps/${appId}/trace`)
}

export const updateTracingStatus: Fetcher<CommonResponse, { appId: string; body: Record<string, any> }> = ({ appId, body }) => {
  return post(`/apps/${appId}/trace`, { body })
}

export const fetchTracingConfig: Fetcher<TracingConfig & { has_not_configured: true }, { appId: string; provider: TracingProvider }> = ({ appId, provider }) => {
  return get(`/apps/${appId}/trace-config`, {
    params: {
      tracing_provider: provider,
    },
  })
}

export const addTracingConfig: Fetcher<CommonResponse, { appId: string; body: TracingConfig }> = ({ appId, body }) => {
  return post(`/apps/${appId}/trace-config`, { body })
}

export const updateTracingConfig: Fetcher<CommonResponse, { appId: string; body: TracingConfig }> = ({ appId, body }) => {
  return patch(`/apps/${appId}/trace-config`, { body })
}

export const removeTracingConfig: Fetcher<CommonResponse, { appId: string; provider: TracingProvider }> = ({ appId, provider }) => {
  return del(`/apps/${appId}/trace-config?tracing_provider=${provider}`)
}
