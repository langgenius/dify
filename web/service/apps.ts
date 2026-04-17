import type { TracingProvider } from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/type'
import type { AppDetailResponse, AppListResponse, CreateApiKeyResponse, DSLImportMode, DSLImportResponse, TracingConfig, TracingStatus, UpdateAppModelConfigResponse, UpdateAppSiteCodeResponse, WebhookTriggerResponse, WorkflowOnlineUser } from '@/models/app'
import type { CommonResponse } from '@/models/common'
import type { AppIconType, AppModeEnum, ModelConfig } from '@/types/app'
import { del, get, patch, post, put } from './base'
import { consoleClient } from './client'

export const fetchAppList = ({ url, params }: { url: string, params?: Record<string, any> }): Promise<AppListResponse> => {
  return get<AppListResponse>(url, { params })
}

export const fetchWorkflowOnlineUsers = async ({ appIds }: { appIds: string[] }): Promise<Record<string, WorkflowOnlineUser[]>> => {
  if (!appIds.length)
    return {}

  const response = await consoleClient.apps.workflowOnlineUsers({
    query: { app_ids: appIds.join(',') },
  })

  if (!response?.data)
    return {}

  if (Array.isArray(response.data)) {
    return response.data.reduce<Record<string, WorkflowOnlineUser[]>>((acc, item) => {
      if (item?.app_id)
        acc[item.app_id] = item.users || []
      return acc
    }, {})
  }

  return Object.entries(response.data).reduce<Record<string, WorkflowOnlineUser[]>>((acc, [appId, users]) => {
    if (appId)
      acc[appId] = users || []
    return acc
  }, {})
}

export const fetchAppDetail = ({ url, id }: { url: string, id: string }): Promise<AppDetailResponse> => {
  return get<AppDetailResponse>(`${url}/${id}`)
}

export const fetchAppDetailDirect = async ({ url, id }: { url: string, id: string }): Promise<AppDetailResponse> => {
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
  return post<AppDetailResponse>('apps', { body: { name, icon_type, icon, icon_background, mode, description, model_config: config } })
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
  const body = { name, icon_type, icon, icon_background, description, use_icon_as_answer_icon, max_active_requests }
  return put<AppDetailResponse>(`apps/${appID}`, { body })
}

export const copyApp = ({
  appID,
  name,
  icon_type,
  icon,
  icon_background,
  mode,
  description,
}: {
  appID: string
  name: string
  icon_type: AppIconType
  icon: string
  icon_background?: string | null
  mode: AppModeEnum
  description?: string
}): Promise<AppDetailResponse> => {
  return post<AppDetailResponse>(`apps/${appID}/copy`, { body: { name, icon_type, icon, icon_background, mode, description } })
}

export const exportAppConfig = ({ appID, include = false, workflowID }: { appID: string, include?: boolean, workflowID?: string }): Promise<{ data: string }> => {
  const params = new URLSearchParams({
    include_secret: include.toString(),
  })
  if (workflowID)
    params.append('workflow_id', workflowID)
  return get<{ data: string }>(`apps/${appID}/export?${params.toString()}`)
}

export const importDSL = ({ mode, yaml_content, yaml_url, app_id, name, description, icon_type, icon, icon_background }: { mode: DSLImportMode, yaml_content?: string, yaml_url?: string, app_id?: string, name?: string, description?: string, icon_type?: AppIconType, icon?: string, icon_background?: string }): Promise<DSLImportResponse> => {
  return post<DSLImportResponse>('apps/imports', { body: { mode, yaml_content, yaml_url, app_id, name, description, icon, icon_type, icon_background } })
}

export const importDSLConfirm = ({ import_id }: { import_id: string }): Promise<DSLImportResponse> => {
  return post<DSLImportResponse>(`apps/imports/${import_id}/confirm`, { body: {} })
}

export const switchApp = ({ appID, name, icon_type, icon, icon_background }: { appID: string, name: string, icon_type: AppIconType, icon: string, icon_background?: string | null }): Promise<{ new_app_id: string }> => {
  return post<{ new_app_id: string }>(`apps/${appID}/convert-to-workflow`, { body: { name, icon_type, icon, icon_background } })
}

export const deleteApp = (appID: string): Promise<CommonResponse> => {
  return del<CommonResponse>(`apps/${appID}`)
}

export const updateAppSiteStatus = ({ url, body }: { url: string, body: Record<string, any> }): Promise<AppDetailResponse> => {
  return post<AppDetailResponse>(url, { body })
}

export const updateAppSiteAccessToken = ({ url }: { url: string }): Promise<UpdateAppSiteCodeResponse> => {
  return post<UpdateAppSiteCodeResponse>(url)
}

export const updateAppSiteConfig = ({ url, body }: { url: string, body: Record<string, any> }): Promise<AppDetailResponse> => {
  return post<AppDetailResponse>(url, { body })
}

export const updateAppModelConfig = ({ url, body }: { url: string, body: Record<string, any> }): Promise<UpdateAppModelConfigResponse> => {
  return post<UpdateAppModelConfigResponse>(url, { body })
}

export const delApikey = ({ url, params }: { url: string, params: Record<string, any> }): Promise<CommonResponse> => {
  return del<CommonResponse>(url, params)
}

export const createApikey = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CreateApiKeyResponse> => {
  return post<CreateApiKeyResponse>(url, body)
}

// Tracing
export const fetchTracingStatus = ({ appId }: { appId: string }): Promise<TracingStatus> => {
  return get<TracingStatus>(`/apps/${appId}/trace`)
}

export const updateTracingStatus = ({ appId, body }: { appId: string, body: Record<string, any> }): Promise<CommonResponse> => {
  return post<CommonResponse>(`/apps/${appId}/trace`, { body })
}

// Webhook Trigger
export const fetchWebhookUrl = ({ appId, nodeId }: { appId: string, nodeId: string }): Promise<WebhookTriggerResponse> => {
  return get<WebhookTriggerResponse>(
    `apps/${appId}/workflows/triggers/webhook`,
    { params: { node_id: nodeId } },
    { silent: true },
  )
}

export const fetchTracingConfig = ({ appId, provider }: { appId: string, provider: TracingProvider }): Promise<TracingConfig & { has_not_configured: true }> => {
  return get<TracingConfig & { has_not_configured: true }>(`/apps/${appId}/trace-config`, {
    params: {
      tracing_provider: provider,
    },
  })
}

export const addTracingConfig = ({ appId, body }: { appId: string, body: TracingConfig }): Promise<CommonResponse> => {
  return post<CommonResponse>(`/apps/${appId}/trace-config`, { body })
}

export const updateTracingConfig = ({ appId, body }: { appId: string, body: TracingConfig }): Promise<CommonResponse> => {
  return patch<CommonResponse>(`/apps/${appId}/trace-config`, { body })
}

export const removeTracingConfig = ({ appId, provider }: { appId: string, provider: TracingProvider }): Promise<CommonResponse> => {
  return del<CommonResponse>(`/apps/${appId}/trace-config?tracing_provider=${provider}`)
}
