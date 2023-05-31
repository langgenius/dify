import type { Fetcher } from 'swr'
import { del, get, post } from './base'
import type { ApikeysListResponse, AppDailyConversationsResponse, AppDailyEndUsersResponse, AppDetailResponse, AppListResponse, AppStatisticsResponse, AppTemplatesResponse, AppTokenCostsResponse, CreateApiKeyResponse, GenerationIntroductionResponse, UpdateAppModelConfigResponse, UpdateAppNameResponse, UpdateAppSiteCodeResponse, UpdateOpenAIKeyResponse, ValidateOpenAIKeyResponse } from '@/models/app'
import type { CommonResponse } from '@/models/common'
import type { AppMode, ModelConfig } from '@/types/app'

export const fetchAppList: Fetcher<AppListResponse, { url: string; params?: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<AppListResponse>
}

export const fetchAppDetail: Fetcher<AppDetailResponse, { url: string; id: string }> = ({ url, id }) => {
  return get(`${url}/${id}`) as Promise<AppDetailResponse>
}

export const fetchAppTemplates: Fetcher<AppTemplatesResponse, { url: string }> = ({ url }) => {
  return get(url) as Promise<AppTemplatesResponse>
}

export const createApp: Fetcher<AppDetailResponse, { name: string; icon: string; icon_background: string; mode: AppMode; config?: ModelConfig }> = ({ name, icon, icon_background, mode, config }) => {
  return post('apps', { body: { name, icon, icon_background, mode, model_config: config } }) as Promise<AppDetailResponse>
}

export const deleteApp: Fetcher<CommonResponse, string> = (appID) => {
  return del(`apps/${appID}`) as Promise<CommonResponse>
}

// path: /apps/{appId}/name
export const updateAppName: Fetcher<UpdateAppNameResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<UpdateAppNameResponse>
}

export const updateAppSiteStatus: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<AppDetailResponse>
}

export const updateAppApiStatus: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<AppDetailResponse>
}

// path: /apps/{appId}/rate-limit
export const updateAppRateLimit: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<AppDetailResponse>
}

export const updateAppSiteAccessToken: Fetcher<UpdateAppSiteCodeResponse, { url: string }> = ({ url }) => {
  return post(url) as Promise<UpdateAppSiteCodeResponse>
}

export const updateAppSiteConfig: Fetcher<AppDetailResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<AppDetailResponse>
}

export const getAppDailyConversations: Fetcher<AppDailyConversationsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<AppDailyConversationsResponse>
}

export const getAppStatistics: Fetcher<AppStatisticsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<AppStatisticsResponse>
}

export const getAppDailyEndUsers: Fetcher<AppDailyEndUsersResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<AppDailyEndUsersResponse>
}

export const getAppTokenCosts: Fetcher<AppTokenCostsResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, { params }) as Promise<AppTokenCostsResponse>
}

export const updateAppModelConfig: Fetcher<UpdateAppModelConfigResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, { body }) as Promise<UpdateAppModelConfigResponse>
}

// For temp testing
export const fetchAppListNoMock: Fetcher<AppListResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, params) as Promise<AppListResponse>
}

export const fetchApiKeysList: Fetcher<ApikeysListResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get(url, params) as Promise<ApikeysListResponse>
}

export const delApikey: Fetcher<CommonResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return del(url, params) as Promise<CommonResponse>
}

export const createApikey: Fetcher<CreateApiKeyResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post(url, body) as Promise<CreateApiKeyResponse>
}

export const validateOpenAIKey: Fetcher<ValidateOpenAIKeyResponse, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post(url, { body }) as Promise<ValidateOpenAIKeyResponse>
}

export const updateOpenAIKey: Fetcher<UpdateOpenAIKeyResponse, { url: string; body: { token: string } }> = ({ url, body }) => {
  return post(url, { body }) as Promise<UpdateOpenAIKeyResponse>
}

export const generationIntroduction: Fetcher<GenerationIntroductionResponse, { url: string; body: { prompt_template: string } }> = ({ url, body }) => {
  return post(url, { body }) as Promise<GenerationIntroductionResponse>
}
