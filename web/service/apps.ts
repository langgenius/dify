import type { TracingProvider } from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/type'
import type {
  AppDetailResponse,
  TracingConfig,
  TracingStatus,
  UpdateAppModelConfigResponse,
  WebhookTriggerResponse,
} from '@/models/app'
import type { CommonResponse } from '@/models/common'
import type { AppIconType, AppModeEnum, ModelConfig } from '@/types/app'
import { del, get, patch, post, put } from './base'

export const fetchAppDetail = ({
  url,
  id,
}: {
  url: string
  id: string
}): Promise<AppDetailResponse> => {
  return get<AppDetailResponse>(`${url}/${id}`)
}

export const fetchAppDetailDirect = async ({
  url,
  id,
}: {
  url: string
  id: string
}): Promise<AppDetailResponse> => {
  return get<AppDetailResponse>(`${url}/${id}`)
}

export const createApp = ({
  name,
  icon_type,
  icon,
  icon_background,
  mode,
  description,
  config,
}: {
  name: string
  icon_type?: AppIconType
  icon?: string
  icon_background?: string
  mode: AppModeEnum
  description?: string
  config?: ModelConfig
}): Promise<AppDetailResponse> => {
  return post<AppDetailResponse>('apps', {
    body: { name, icon_type, icon, icon_background, mode, description, model_config: config },
  })
}

export const updateAppInfo = ({
  appID,
  name,
  icon_type,
  icon,
  icon_background,
  description,
  use_icon_as_answer_icon,
  max_active_requests,
}: {
  appID: string
  name: string
  icon_type: AppIconType
  icon: string
  icon_background?: string
  description: string
  use_icon_as_answer_icon?: boolean
  max_active_requests?: number | null
}): Promise<AppDetailResponse> => {
  const body = {
    name,
    icon_type,
    icon,
    icon_background,
    description,
    use_icon_as_answer_icon,
    max_active_requests,
  }
  return put<AppDetailResponse>(`apps/${appID}`, { body })
}

export const deleteApp = (appID: string): Promise<CommonResponse> => {
  return del<CommonResponse>(`apps/${appID}`)
}

export const updateAppSiteConfig = ({
  url,
  body,
}: {
  url: string
  body: Record<string, any>
}): Promise<AppDetailResponse> => {
  return post<AppDetailResponse>(url, { body })
}

export const updateAppModelConfig = ({
  url,
  body,
}: {
  url: string
  body: Record<string, any>
}): Promise<UpdateAppModelConfigResponse> => {
  return post<UpdateAppModelConfigResponse>(url, { body })
}

// Tracing
export const fetchTracingStatus = ({ appId }: { appId: string }): Promise<TracingStatus> => {
  return get<TracingStatus>(`/apps/${appId}/trace`)
}

export const updateTracingStatus = ({
  appId,
  body,
}: {
  appId: string
  body: Record<string, any>
}): Promise<CommonResponse> => {
  return post<CommonResponse>(`/apps/${appId}/trace`, { body })
}

// Webhook Trigger
export const fetchWebhookUrl = ({
  appId,
  nodeId,
}: {
  appId: string
  nodeId: string
}): Promise<WebhookTriggerResponse> => {
  return get<WebhookTriggerResponse>(
    `apps/${appId}/workflows/triggers/webhook`,
    { params: { node_id: nodeId } },
    { silent: true },
  )
}

export const fetchTracingConfig = ({
  appId,
  provider,
}: {
  appId: string
  provider: TracingProvider
}): Promise<TracingConfig & { has_not_configured: true }> => {
  return get<TracingConfig & { has_not_configured: true }>(`/apps/${appId}/trace-config`, {
    params: {
      tracing_provider: provider,
    },
  })
}

export const addTracingConfig = ({
  appId,
  body,
}: {
  appId: string
  body: TracingConfig
}): Promise<CommonResponse> => {
  return post<CommonResponse>(`/apps/${appId}/trace-config`, { body })
}

export const updateTracingConfig = ({
  appId,
  body,
}: {
  appId: string
  body: TracingConfig
}): Promise<CommonResponse> => {
  return patch<CommonResponse>(`/apps/${appId}/trace-config`, { body })
}

export const removeTracingConfig = ({
  appId,
  provider,
}: {
  appId: string
  provider: TracingProvider
}): Promise<CommonResponse> => {
  return del<CommonResponse>(`/apps/${appId}/trace-config?tracing_provider=${provider}`)
}

type PublishToCreatorsPlatformResponse = {
  redirect_url: string
}

export const publishToCreatorsPlatform = ({
  appID,
}: {
  appID: string
}): Promise<PublishToCreatorsPlatformResponse> => {
  return post<PublishToCreatorsPlatformResponse>(`apps/${appID}/publish-to-creators-platform`, {
    body: {},
  })
}
