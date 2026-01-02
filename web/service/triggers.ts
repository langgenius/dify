import type { FormOption } from '@/app/components/base/form/types'
import type {
  TriggerLogEntity,
  TriggerOAuthClientParams,
  TriggerOAuthConfig,
  TriggerProviderApiEntity,
  TriggerSubscription,
  TriggerSubscriptionBuilder,
} from '@/app/components/workflow/block-selector/types'
import { del, get, post } from './base'

export const fetchTriggerProviders = () => {
  return get<TriggerProviderApiEntity[]>('/workspaces/current/triggers')
}

export const fetchTriggerProvidersByType = (triggerType: string) => {
  return get<TriggerProviderApiEntity[]>(`/workspaces/current/triggers?type=${triggerType}`)
}

export const fetchTriggerProviderInfo = (provider: string) => {
  return get<TriggerProviderApiEntity>(`/workspaces/current/trigger-provider/${provider}/info`)
}

export const fetchTriggerSubscriptions = (provider: string) => {
  return get<TriggerSubscription[]>(`/workspaces/current/trigger-provider/${provider}/subscriptions/list`)
}

export const createTriggerSubscriptionBuilder = (payload: { provider: string, credential_type?: string }) => {
  const { provider, ...body } = payload
  return post<{ subscription_builder: TriggerSubscriptionBuilder }>(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/create`,
    { body },
  )
}

export const updateTriggerSubscriptionBuilder = (payload: {
  provider: string
  subscriptionBuilderId: string
  name?: string
  properties?: Record<string, unknown>
  parameters?: Record<string, unknown>
  credentials?: Record<string, unknown>
}) => {
  const { provider, subscriptionBuilderId, ...body } = payload
  return post<TriggerSubscriptionBuilder>(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/update/${subscriptionBuilderId}`,
    { body },
  )
}

export const verifyAndUpdateTriggerSubscriptionBuilder = (payload: {
  provider: string
  subscriptionBuilderId: string
  credentials?: Record<string, unknown>
}) => {
  const { provider, subscriptionBuilderId, ...body } = payload
  return post<{ verified: boolean }>(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/verify-and-update/${subscriptionBuilderId}`,
    { body },
    { silent: true },
  )
}

export const verifyTriggerSubscription = (payload: {
  provider: string
  subscriptionId: string
  credentials?: Record<string, unknown>
}) => {
  const { provider, subscriptionId, ...body } = payload
  return post<{ verified: boolean }>(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/verify/${subscriptionId}`,
    { body },
    { silent: true },
  )
}

export const buildTriggerSubscription = (payload: {
  provider: string
  subscriptionBuilderId: string
  name?: string
  parameters?: Record<string, unknown>
}) => {
  const { provider, subscriptionBuilderId, ...body } = payload
  return post(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/build/${subscriptionBuilderId}`,
    { body },
  )
}

export const deleteTriggerSubscription = (subscriptionId: string) => {
  return post<{ result: string }>(
    `/workspaces/current/trigger-provider/${subscriptionId}/subscriptions/delete`,
  )
}

export const updateTriggerSubscription = (payload: {
  subscriptionId: string
  name?: string
  properties?: Record<string, unknown>
  parameters?: Record<string, unknown>
  credentials?: Record<string, unknown>
}) => {
  const { subscriptionId, ...body } = payload
  return post<{ result: string, id: string }>(
    `/workspaces/current/trigger-provider/${subscriptionId}/subscriptions/update`,
    { body },
  )
}

export const fetchTriggerSubscriptionBuilderLogs = (provider: string, subscriptionBuilderId: string) => {
  return get<{ logs: TriggerLogEntity[] }>(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/logs/${subscriptionBuilderId}`,
  )
}

export const fetchTriggerOAuthConfig = (provider: string) => {
  return get<TriggerOAuthConfig>(`/workspaces/current/trigger-provider/${provider}/oauth/client`)
}

export const configureTriggerOAuth = (payload: { provider: string, client_params?: TriggerOAuthClientParams, enabled: boolean }) => {
  const { provider, ...body } = payload
  return post<{ result: string }>(
    `/workspaces/current/trigger-provider/${provider}/oauth/client`,
    { body },
  )
}

export const deleteTriggerOAuth = (provider: string) => {
  return del<{ result: string }>(`/workspaces/current/trigger-provider/${provider}/oauth/client`)
}

export const initiateTriggerOAuth = (provider: string) => {
  return get<{ authorization_url: string, subscription_builder: TriggerSubscriptionBuilder }>(
    `/workspaces/current/trigger-provider/${provider}/subscriptions/oauth/authorize`,
    {},
    { silent: true },
  )
}

export const fetchTriggerDynamicOptions = (payload: {
  plugin_id: string
  provider: string
  action: string
  parameter: string
  credential_id: string
  extra?: Record<string, unknown>
}) => {
  return get<{ options: FormOption[] }>(
    '/workspaces/current/plugin/parameters/dynamic-options',
    {
      params: {
        plugin_id: payload.plugin_id,
        provider: payload.provider,
        action: payload.action,
        parameter: payload.parameter,
        credential_id: payload.credential_id,
        provider_type: 'trigger',
        ...payload.extra,
      },
    },
    { silent: true },
  )
}

export const fetchTriggerDynamicOptionsWithCredentials = (payload: {
  plugin_id: string
  provider: string
  action: string
  parameter: string
  credential_id: string
  credentials: Record<string, unknown>
}) => {
  return post<{ options: FormOption[] }>(
    '/workspaces/current/plugin/parameters/dynamic-options-with-credentials',
    {
      body: {
        plugin_id: payload.plugin_id,
        provider: payload.provider,
        action: payload.action,
        parameter: payload.parameter,
        credential_id: payload.credential_id,
        credentials: payload.credentials,
      },
    },
    { silent: true },
  )
}
