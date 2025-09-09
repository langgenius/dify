import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post } from './base'
import type {
  TriggerOAuthClientParams,
  TriggerOAuthConfig,
  TriggerProviderApiEntity,
  TriggerSubscription,
  TriggerSubscriptionBuilder,
  TriggerWithProvider,
} from '@/app/components/workflow/block-selector/types'
import { CollectionType } from '@/app/components/tools/types'
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
    description: provider.description, // Already TypeWithI18N format
    icon: provider.icon || '',
    label: provider.label, // Already TypeWithI18N format
    type: CollectionType.builtIn,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: provider.tags || [],
    plugin_id: provider.plugin_id,
    triggers: provider.triggers.map(trigger => ({
      name: trigger.name,
      author: provider.author,
      label: trigger.description.human, // Already TypeWithI18N format
      description: trigger.description.llm, // Already TypeWithI18N format
      parameters: trigger.parameters.map(param => ({
        name: param.name,
        label: param.label, // Already TypeWithI18N format
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
      output_schema: trigger.output_schema || {},
    })),

    // Trigger-specific schema fields
    credentials_schema: provider.credentials_schema,
    oauth_client_schema: provider.oauth_client_schema,
    subscription_schema: provider.subscription_schema,

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
export const useTriggerSubscriptions = (provider: string, enabled = true) => {
  return useQuery<TriggerSubscription[]>({
    queryKey: [NAME_SPACE, 'subscriptions', provider],
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
      name?: string
      credentials?: Record<string, any>
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
      parameters?: Record<string, any>
      properties?: Record<string, any>
      credentials?: Record<string, any>
    }) => {
      const { provider, subscriptionBuilderId, ...body } = payload
      return post<TriggerSubscriptionBuilder>(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/update/${subscriptionBuilderId}`,
        { body },
      )
    },
  })
}

export const useVerifyTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'verify-subscription-builder'],
    mutationFn: (payload: {
      provider: string
      subscriptionBuilderId: string
    }) => {
      const { provider, subscriptionBuilderId } = payload
      return post(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/verify/${subscriptionBuilderId}`,
      )
    },
  })
}

export const useBuildTriggerSubscription = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'build-subscription'],
    mutationFn: (payload: {
      provider: string
      subscriptionBuilderId: string
    }) => {
      const { provider, subscriptionBuilderId } = payload
      return post(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/builder/build/${subscriptionBuilderId}`,
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

export const useTriggerSubscriptionBuilderLogs = (
  provider: string,
  subscriptionBuilderId: string,
  options: {
    enabled?: boolean
    refetchInterval?: number | false
  } = {},
) => {
  const { enabled = true, refetchInterval = false } = options

  return useQuery<Record<string, any>[]>({
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

export const useConfigureTriggerOAuth = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'configure-oauth'],
    mutationFn: (payload: {
      provider: string
      client_params: TriggerOAuthClientParams
      enabled: boolean
    }) => {
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
      return get<{ authorization_url: string; subscription_builder: any }>(
        `/workspaces/current/trigger-provider/${provider}/subscriptions/oauth/authorize`,
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
  extra?: Record<string, any>
}, enabled = true) => {
  return useQuery<{ options: Array<{ value: string; label: any }> }>({
    queryKey: [NAME_SPACE, 'dynamic-options', payload.plugin_id, payload.provider, payload.action, payload.parameter, payload.extra],
    queryFn: () => get<{ options: Array<{ value: string; label: any }> }>(
      '/workspaces/current/plugin/parameters/dynamic-options',
      {
        params: {
          ...payload,
          provider_type: 'trigger', // Add required provider_type parameter
        },
      },
    ),
    enabled: enabled && !!payload.plugin_id && !!payload.provider && !!payload.action && !!payload.parameter,
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
