import type { TracingProvider } from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/type'
import type { TracingConfig, TracingStatus, WebhookTriggerResponse } from '@/models/app'
import type { CommonResponse } from '@/models/common'
import { del, get, patch, post } from './base'

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
