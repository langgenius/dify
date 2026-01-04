import type { FormOption } from '@/app/components/base/form/types'
import type {
  TriggerLogEntity,
  TriggerOAuthClientParams,
  TriggerOAuthConfig,
  TriggerProviderApiEntity,
  TriggerSubscription,
  TriggerSubscriptionBuilder,
  TriggerWithProvider,
} from '@/app/components/workflow/block-selector/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CollectionType } from '@/app/components/tools/types'
import { del, get, post } from './base'
import { useInvalid } from './use-base'

const NAME_SPACE = 'triggers'

// Trigger Provider Service - Provider ID Format: plugin_id/provider_name

// Convert backend API response to frontend ToolWithProvider format
const convertToTriggerWithProvider = (provider: TriggerProviderApiEntity): TriggerWithProvider => {
  return {
    // Collection fields
    id: provider.plugin_id || provider.name,
    name: provider.name,
    author: provider.author,
    description: provider.description,
    icon: provider.icon || '',
    icon_dark: provider.icon_dark || '',
    label: provider.label,
    type: CollectionType.trigger,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: provider.tags || [],
    plugin_id: provider.plugin_id,
    plugin_unique_identifier: provider.plugin_unique_identifier || '',
    events: provider.events.map(event => ({
      name: event.name,
      author: provider.author,
      label: event.identity.label,
      description: event.description,
      parameters: event.parameters.map(param => ({
        name: param.name,
        label: param.label,
        human_description: param.description || param.label,
        type: param.type,
        form: param.type,
        llm_description: JSON.stringify(param.description || {}),
        required: param.required || false,
        default: param.default || '',
        options: param.options?.map(option => ({
          label: option.label,
          value: option.value,
        })) || [],
        multiple: param.multiple || false,
      })),
      labels: provider.tags || [],
      output_schema: event.output_schema || {},
    })),

    // Trigger-specific schema fields
    subscription_constructor: provider.subscription_constructor,
    subscription_schema: provider.subscription_schema,
    supported_creation_methods: provider.supported_creation_methods,

    meta: {
      version: '1.0',
    },
  }
}

export const useAllTriggerPlugins = (enabled = true) => {
  return useQuery<TriggerWithProvider[]>({
    queryKey: [NAME_SPACE, 'all'],
    queryFn: async () => {
      const response = await get<TriggerProviderApiEntity[]>('/workspaces/current/triggers')
      return response.map(convertToTriggerWithProvider)
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

export const useTriggerPluginsByType = (triggerType: string, enabled = true) => {
  return useQuery<TriggerWithProvider[]>({
    queryKey: [NAME_SPACE, 'byType', triggerType],
    queryFn: async () => {
      const response = await get<TriggerProviderApiEntity[]>(`/workspaces/current/triggers?type=${triggerType}`)
      return response.map(convertToTriggerWithProvider)
    },
    enabled: enabled && !!triggerType,
  })
}

export const useInvalidateAllTriggerPlugins = () => {
  return useInvalid([NAME_SPACE, 'all'])
}

// ===== Trigger Subscriptions Management =====

export const useTriggerProviderInfo = (provider: string, enabled = true) => {
  return useQuery<TriggerProviderApiEntity>({
    queryKey: [NAME_SPACE, 'provider-info', provider],
    queryFn: () => get<TriggerProviderApiEntity>(`/workspaces/current/trigger-provider/${provider}/info`),
    enabled: enabled && !!provider,
    staleTime: 0,
    gcTime: 0,
  })
}

export const useTriggerSubscriptions = (provider: string, enabled = true) => {
  return useQuery<TriggerSubscription[]>({
    queryKey: [NAME_SPACE, 'list-subscriptions', provider],
    queryFn: () => get<TriggerSubscription[]>(`/workspaces/current/trigger-provider/${provider}/subscriptions/list`),
    enabled: enabled && !!provider,
  })
}

export const useInvalidateTriggerSubscriptions = () => {
  const queryClient = useQueryClient()
  return (provider: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'subscriptions', provider],
    })
  }
}

export const useCreateTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'create-subscription-builder'],
    mutationFn: (payload: {
      provider: string
      credential_type?: string
    }) => {
      const { provider, ...body } = payload
      return post<{ subscription_builder: TriggerSubscriptionBuilder }>(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/create`,
        { body },
      )
    },
  })
}

export const useUpdateTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-subscription-builder'],
    mutationFn: (payload: {
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
    },
  })
}

export const useVerifyAndUpdateTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'verify-and-update-subscription-builder'],
    mutationFn: (payload: {
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
    },
  })
}

export const useVerifyTriggerSubscription = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'verify-subscription'],
    mutationFn: (payload: {
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
    },
  })
}

export type BuildTriggerSubscriptionPayload = {
  provider: string
  subscriptionBuilderId: string
  name?: string
  parameters?: Record<string, unknown>
}

export const useBuildTriggerSubscription = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'build-subscription'],
    mutationFn: (payload: BuildTriggerSubscriptionPayload) => {
      const { provider, subscriptionBuilderId, ...body } = payload
      return post(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/build/${subscriptionBuilderId}`,
        { body },
      )
    },
  })
}

export const useDeleteTriggerSubscription = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete-subscription'],
    mutationFn: (subscriptionId: string) => {
      return post<{ result: string }>(
        `/workspaces/current/trigger-provider/${subscriptionId}/subscriptions/delete`,
      )
    },
  })
}

export type UpdateTriggerSubscriptionPayload = {
  subscriptionId: string
  name?: string
  properties?: Record<string, unknown>
  parameters?: Record<string, unknown>
  credentials?: Record<string, unknown>
}

export const useUpdateTriggerSubscription = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-subscription'],
    mutationFn: (payload: UpdateTriggerSubscriptionPayload) => {
      const { subscriptionId, ...body } = payload
      return post<{ result: string, id: string }>(
        `/workspaces/current/trigger-provider/${subscriptionId}/subscriptions/update`,
        { body },
      )
    },
  })
}

export const useTriggerSubscriptionBuilderLogs = (
  provider: string,
  subscriptionBuilderId: string,
  options: {
    enabled?: boolean
    refetchInterval?: number | false
  } = {},
) => {
  const { enabled = true, refetchInterval = false } = options

  return useQuery<{ logs: TriggerLogEntity[] }>({
    queryKey: [NAME_SPACE, 'subscription-builder-logs', provider, subscriptionBuilderId],
    queryFn: () => get(
      `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/logs/${subscriptionBuilderId}`,
    ),
    enabled: enabled && !!provider && !!subscriptionBuilderId,
    refetchInterval,
  })
}

// ===== OAuth Management =====
export const useTriggerOAuthConfig = (provider: string, enabled = true) => {
  return useQuery<TriggerOAuthConfig>({
    queryKey: [NAME_SPACE, 'oauth-config', provider],
    queryFn: () => get<TriggerOAuthConfig>(`/workspaces/current/trigger-provider/${provider}/oauth/client`),
    enabled: enabled && !!provider,
  })
}

export type ConfigureTriggerOAuthPayload = {
  provider: string
  client_params?: TriggerOAuthClientParams
  enabled: boolean
}

export const useConfigureTriggerOAuth = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'configure-oauth'],
    mutationFn: (payload: ConfigureTriggerOAuthPayload) => {
      const { provider, ...body } = payload
      return post<{ result: string }>(
        `/workspaces/current/trigger-provider/${provider}/oauth/client`,
        { body },
      )
    },
  })
}

export const useDeleteTriggerOAuth = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete-oauth'],
    mutationFn: (provider: string) => {
      return del<{ result: string }>(
        `/workspaces/current/trigger-provider/${provider}/oauth/client`,
      )
    },
  })
}

export const useInitiateTriggerOAuth = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'initiate-oauth'],
    mutationFn: (provider: string) => {
      return get<{ authorization_url: string, subscription_builder: TriggerSubscriptionBuilder }>(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/oauth/authorize`,
        {},
        { silent: true },
      )
    },
  })
}

// ===== Dynamic Options Support =====
export const useTriggerPluginDynamicOptions = (payload: {
  plugin_id: string
  provider: string
  action: string
  parameter: string
  credential_id: string
  credentials?: Record<string, unknown>
  extra?: Record<string, unknown>
}, enabled = true) => {
  return useQuery<{ options: FormOption[] }>({
    queryKey: [NAME_SPACE, 'dynamic-options', payload.plugin_id, payload.provider, payload.action, payload.parameter, payload.credential_id, payload.credentials, payload.extra],
    queryFn: () => {
      // Use new endpoint with POST when credentials provided (for edit mode)
      if (payload.credentials) {
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
      // Use original GET endpoint for normal cases
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
          },
        },
        { silent: true },
      )
    },
    enabled: enabled && !!payload.plugin_id && !!payload.provider && !!payload.action && !!payload.parameter && !!payload.credential_id,
    retry: 0,
    staleTime: 0,
    gcTime: 0,
  })
}

// ===== Cache Invalidation Helpers =====

export const useInvalidateTriggerOAuthConfig = () => {
  const queryClient = useQueryClient()
  return (provider: string) => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'oauth-config', provider],
    })
  }
}
