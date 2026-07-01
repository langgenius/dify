import type { FormOption } from '@/app/components/base/form/types'
import type { ParametersSchema, PluginTriggerSubscriptionConstructor, TriggerEvent, TriggerEventParameter } from '@/app/components/plugins/types'
import type {
  TriggerLogEntity,
  TriggerOAuthClientParams,
  TriggerOAuthConfig,
  TriggerSubscription,
  TriggerSubscriptionBuilder,
  TriggerWithProvider,
} from '@/app/components/workflow/block-selector/types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { consoleClient, consoleQuery } from '@/service/client'
import { useInvalid } from './use-base'

const NAME_SPACE = 'triggers'

type GeneratedEventParameter = import('@dify/contracts/api/console/workspaces/types.gen').EventParameter
type GeneratedI18nObject = import('@dify/contracts/api/console/workspaces/types.gen').I18nObject
type GeneratedProviderConfig = import('@dify/contracts/api/console/workspaces/types.gen').ProviderConfig
type GeneratedRequestLog = import('@dify/contracts/api/console/workspaces/types.gen').RequestLog
type GeneratedSubscriptionBuilder = import('@dify/contracts/api/console/workspaces/types.gen').SubscriptionBuilderApiEntity
type GeneratedTriggerCreationMethod = import('@dify/contracts/api/console/workspaces/types.gen').TriggerCreationMethod
type GeneratedTriggerOAuthConfig = import('@dify/contracts/api/console/workspaces/types.gen').TriggerOAuthClientResponse
type GeneratedTriggerProvider = import('@dify/contracts/api/console/workspaces/types.gen').TriggerProviderApiEntity
type GeneratedTriggerSubscription = import('@dify/contracts/api/console/workspaces/types.gen').TriggerProviderSubscriptionApiEntity
type TriggerProviderApiEntity = import('@/app/components/workflow/block-selector/types').TriggerProviderApiEntity

const getString = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

const getNumber = (value: unknown) => {
  return typeof value === 'number' ? value : 0
}

const getObjectString = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object')
    return ''

  return getString(Object.entries(value).find(([entryKey]) => entryKey === key)?.[1])
}

const normalizeI18nObject = (value: GeneratedI18nObject | null | undefined, fallback = '') => {
  const en = value?.en_US || fallback
  const zhHans = value?.zh_Hans || en
  const ja = value?.ja_JP || en
  const ptBr = value?.pt_BR || en

  return {
    'en-US': en,
    'zh-Hans': zhHans,
    'zh-Hant': en,
    'pt-BR': ptBr,
    'es-ES': en,
    'fr-FR': en,
    'de-DE': en,
    'ja-JP': ja,
    'ko-KR': en,
    'ru-RU': en,
    'it-IT': en,
    'th-TH': en,
    'uk-UA': en,
    'vi-VN': en,
    'ro-RO': en,
    'pl-PL': en,
    'hi-IN': en,
    'tr-TR': en,
    'fa-IR': en,
    'sl-SI': en,
    'id-ID': en,
    'nl-NL': en,
    'ar-TN': en,
    'en_US': en,
    'zh_Hans': zhHans,
    'ja_JP': ja,
  }
}

const normalizeUnknownI18nObject = (value: unknown, fallback = '') => {
  const en = getObjectString(value, 'en_US') || getObjectString(value, 'en-US') || fallback
  const zhHans = getObjectString(value, 'zh_Hans') || getObjectString(value, 'zh-Hans') || en
  const ja = getObjectString(value, 'ja_JP') || getObjectString(value, 'ja-JP') || en
  const ptBr = getObjectString(value, 'pt_BR') || getObjectString(value, 'pt-BR') || en

  return {
    'en-US': en,
    'zh-Hans': zhHans,
    'zh-Hant': en,
    'pt-BR': ptBr,
    'es-ES': en,
    'fr-FR': en,
    'de-DE': en,
    'ja-JP': ja,
    'ko-KR': en,
    'ru-RU': en,
    'it-IT': en,
    'th-TH': en,
    'uk-UA': en,
    'vi-VN': en,
    'ro-RO': en,
    'pl-PL': en,
    'hi-IN': en,
    'tr-TR': en,
    'fa-IR': en,
    'sl-SI': en,
    'id-ID': en,
    'nl-NL': en,
    'ar-TN': en,
    'en_US': en,
    'zh_Hans': zhHans,
    'ja_JP': ja,
  }
}

const normalizeParameterDefault = (value: unknown) => {
  if (Array.isArray(value))
    return value.filter(item => typeof item === 'string')
  if (typeof value === 'string')
    return value
  if (value === undefined || value === null)
    return undefined
  return String(value)
}

const normalizeProviderOptions = (options: GeneratedProviderConfig['options']) => {
  return options?.map(option => ({
    label: normalizeI18nObject(option.label),
    value: option.value,
  })) ?? []
}

const normalizeEventOptions = (options: GeneratedEventParameter['options']) => {
  return options?.map(option => ({
    icon: option.icon ?? undefined,
    label: normalizeI18nObject(option.label),
    value: option.value,
  })) ?? []
}

const normalizeProviderConfigType = (type: GeneratedProviderConfig['type']): FormTypeEnum => {
  switch (type) {
    case FormTypeEnum.appSelector:
      return FormTypeEnum.appSelector
    case FormTypeEnum.boolean:
      return FormTypeEnum.boolean
    case FormTypeEnum.modelSelector:
      return FormTypeEnum.modelSelector
    case FormTypeEnum.multiToolSelector:
      return FormTypeEnum.multiToolSelector
    case FormTypeEnum.secretInput:
      return FormTypeEnum.secretInput
    case FormTypeEnum.select:
      return FormTypeEnum.select
    case FormTypeEnum.textInput:
      return FormTypeEnum.textInput
  }
  return FormTypeEnum.textInput
}

const normalizeEventParameterFormType = (type: GeneratedEventParameter['type']): FormTypeEnum => {
  switch (type) {
    case FormTypeEnum.appSelector:
      return FormTypeEnum.appSelector
    case FormTypeEnum.boolean:
      return FormTypeEnum.boolean
    case FormTypeEnum.checkbox:
      return FormTypeEnum.checkbox
    case FormTypeEnum.dynamicSelect:
      return FormTypeEnum.dynamicSelect
    case FormTypeEnum.file:
      return FormTypeEnum.file
    case FormTypeEnum.files:
      return FormTypeEnum.files
    case FormTypeEnum.modelSelector:
      return FormTypeEnum.modelSelector
    case FormTypeEnum.select:
      return FormTypeEnum.select
    case 'number':
      return FormTypeEnum.textNumber
    case 'string':
      return FormTypeEnum.textInput
    case 'array':
    case 'object':
      return FormTypeEnum.textInput
  }
  return FormTypeEnum.textInput
}

const normalizeProviderConfig = (schema: GeneratedProviderConfig): ParametersSchema => {
  return {
    name: schema.name,
    label: normalizeI18nObject(schema.label, schema.name),
    type: normalizeProviderConfigType(schema.type),
    auto_generate: undefined,
    template: undefined,
    scope: schema.scope ?? undefined,
    required: schema.required ?? false,
    multiple: schema.multiple ?? false,
    default: normalizeParameterDefault(schema.default),
    min: undefined,
    max: undefined,
    precision: undefined,
    options: normalizeProviderOptions(schema.options),
    description: normalizeI18nObject(undefined),
  }
}

const normalizeCredentialSchema = (schema: GeneratedProviderConfig) => {
  return {
    name: schema.name,
    label: normalizeI18nObject(schema.label, schema.name),
    description: normalizeI18nObject(undefined),
    type: normalizeProviderConfigType(schema.type),
    scope: schema.scope ?? undefined,
    required: schema.required ?? false,
    default: schema.default ?? undefined,
    options: normalizeProviderOptions(schema.options),
    help: normalizeI18nObject(schema.help),
    url: schema.url ?? '',
    placeholder: normalizeI18nObject(schema.placeholder),
  }
}

const normalizeEventParameterToSchema = (parameter: GeneratedEventParameter): ParametersSchema => {
  return {
    name: parameter.name,
    label: normalizeI18nObject(parameter.label, parameter.name),
    type: normalizeEventParameterFormType(parameter.type),
    auto_generate: parameter.auto_generate ?? undefined,
    template: parameter.template ?? undefined,
    scope: parameter.scope ?? undefined,
    required: parameter.required ?? false,
    multiple: parameter.multiple ?? false,
    default: normalizeParameterDefault(parameter.default),
    min: parameter.min ?? undefined,
    max: parameter.max ?? undefined,
    precision: parameter.precision ?? undefined,
    options: normalizeEventOptions(parameter.options),
    description: normalizeI18nObject(parameter.description),
  }
}

const normalizeEventParameter = (parameter: GeneratedEventParameter): TriggerEventParameter => {
  return {
    name: parameter.name,
    label: normalizeI18nObject(parameter.label, parameter.name),
    type: parameter.type,
    auto_generate: parameter.auto_generate ?? undefined,
    template: parameter.template ?? undefined,
    scope: parameter.scope ?? undefined,
    required: parameter.required ?? false,
    multiple: parameter.multiple ?? false,
    default: parameter.default ?? '',
    min: parameter.min ?? undefined,
    max: parameter.max ?? undefined,
    precision: parameter.precision ?? undefined,
    options: normalizeEventOptions(parameter.options),
    description: normalizeI18nObject(parameter.description),
  }
}

const normalizeTriggerEvent = (event: GeneratedTriggerProvider['events'][number]): TriggerEvent => {
  return {
    name: event.name,
    identity: {
      author: event.identity.author,
      name: event.identity.name,
      label: normalizeI18nObject(event.identity.label, event.name),
      provider: event.identity.provider ?? undefined,
    },
    description: normalizeI18nObject(event.description, event.name),
    parameters: event.parameters.map(normalizeEventParameter),
    output_schema: event.output_schema ?? {},
  }
}

const normalizeSupportedCreationMethod = (method: GeneratedTriggerCreationMethod): SupportedCreationMethods => {
  switch (method) {
    case SupportedCreationMethods.APIKEY:
      return SupportedCreationMethods.APIKEY
    case SupportedCreationMethods.MANUAL:
      return SupportedCreationMethods.MANUAL
    case SupportedCreationMethods.OAUTH:
      return SupportedCreationMethods.OAUTH
  }
  return SupportedCreationMethods.MANUAL
}

const normalizeSubscriptionConstructor = (
  constructor: GeneratedTriggerProvider['subscription_constructor'],
): PluginTriggerSubscriptionConstructor | null => {
  if (!constructor)
    return null

  return {
    credentials_schema: (constructor.credentials_schema ?? []).map(normalizeCredentialSchema),
    oauth_schema: {
      client_schema: (constructor.oauth_schema?.client_schema ?? []).map(normalizeCredentialSchema),
      credentials_schema: (constructor.oauth_schema?.credentials_schema ?? []).map(normalizeCredentialSchema),
    },
    parameters: (constructor.parameters ?? []).map(normalizeEventParameterToSchema),
  }
}

export const normalizeTriggerProvider = (provider: GeneratedTriggerProvider): TriggerProviderApiEntity => {
  return {
    author: provider.author,
    name: provider.name,
    label: normalizeI18nObject(provider.label, provider.name),
    description: normalizeI18nObject(provider.description),
    icon: provider.icon ?? undefined,
    icon_dark: provider.icon_dark ?? undefined,
    tags: provider.tags ?? [],
    plugin_id: provider.plugin_id ?? undefined,
    plugin_unique_identifier: provider.plugin_unique_identifier ?? '',
    supported_creation_methods: (provider.supported_creation_methods ?? []).map(normalizeSupportedCreationMethod),
    subscription_constructor: normalizeSubscriptionConstructor(provider.subscription_constructor),
    subscription_schema: (provider.subscription_schema ?? []).map(normalizeProviderConfig),
    events: provider.events.map(normalizeTriggerEvent),
  }
}

const normalizeCredentialType = (credentialType: GeneratedTriggerSubscription['credential_type']): TriggerCredentialTypeEnum => {
  switch (credentialType) {
    case TriggerCredentialTypeEnum.ApiKey:
      return TriggerCredentialTypeEnum.ApiKey
    case TriggerCredentialTypeEnum.Oauth2:
      return TriggerCredentialTypeEnum.Oauth2
    case TriggerCredentialTypeEnum.Unauthorized:
      return TriggerCredentialTypeEnum.Unauthorized
  }
  return TriggerCredentialTypeEnum.Unauthorized
}

const normalizeTriggerSubscription = (subscription: GeneratedTriggerSubscription): TriggerSubscription => {
  return {
    id: subscription.id,
    name: subscription.name,
    provider: subscription.provider,
    credential_type: normalizeCredentialType(subscription.credential_type),
    credentials: subscription.credentials,
    endpoint: subscription.endpoint,
    parameters: subscription.parameters,
    properties: subscription.properties,
    workflows_in_use: subscription.workflows_in_use,
  }
}

const normalizeTriggerSubscriptionBuilder = (builder: GeneratedSubscriptionBuilder): TriggerSubscriptionBuilder => {
  return {
    id: builder.id,
    name: builder.name,
    provider: builder.provider,
    credential_type: normalizeCredentialType(builder.credential_type),
    credentials: builder.credentials,
    endpoint: builder.endpoint,
    parameters: builder.parameters,
    properties: builder.properties,
    workflows_in_use: 0,
  }
}

const normalizeStringRecord = (record: Record<string, unknown>) => {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, getString(value)]))
}

const normalizeTriggerOAuthConfig = (config: GeneratedTriggerOAuthConfig): TriggerOAuthConfig => {
  const params = normalizeStringRecord(config.params)

  return {
    configured: config.configured,
    custom_configured: config.custom_configured,
    custom_enabled: config.custom_enabled,
    redirect_uri: config.redirect_uri,
    oauth_client_schema: config.oauth_client_schema.map(normalizeProviderConfig),
    params: {
      ...params,
      client_id: params.client_id ?? '',
      client_secret: params.client_secret ?? '',
    },
    system_configured: config.system_configured,
  }
}

const normalizeDynamicOptionLabel = (label: unknown, fallback: string) => {
  if (typeof label === 'string')
    return label

  return normalizeUnknownI18nObject(label, fallback)
}

const normalizeDynamicOption = (option: unknown): FormOption | null => {
  if (!option || typeof option !== 'object')
    return null

  const value = getObjectString(option, 'value')
  if (!value)
    return null

  const label = Object.entries(option).find(([key]) => key === 'label')?.[1]
  const icon = getObjectString(option, 'icon')
  const normalizedOption: FormOption = {
    label: normalizeDynamicOptionLabel(label, value),
    value,
  }

  if (icon)
    normalizedOption.icon = icon

  return normalizedOption
}

const isFormOption = (option: FormOption | null): option is FormOption => {
  return option !== null
}

const normalizeDynamicOptionsResponse = (response: { options: unknown }): { options: FormOption[] } => {
  return {
    options: Array.isArray(response.options)
      ? response.options.map(normalizeDynamicOption).filter(isFormOption)
      : [],
  }
}

const normalizeLogHeaders = (headers: unknown) => {
  return {
    'Host': getObjectString(headers, 'Host'),
    'User-Agent': getObjectString(headers, 'User-Agent'),
    'Content-Length': getObjectString(headers, 'Content-Length'),
    'Accept': getObjectString(headers, 'Accept'),
    'Content-Type': getObjectString(headers, 'Content-Type'),
    'X-Forwarded-For': getObjectString(headers, 'X-Forwarded-For'),
    'X-Forwarded-Host': getObjectString(headers, 'X-Forwarded-Host'),
    'X-Forwarded-Proto': getObjectString(headers, 'X-Forwarded-Proto'),
    'X-Github-Delivery': getObjectString(headers, 'X-Github-Delivery'),
    'X-Github-Event': getObjectString(headers, 'X-Github-Event'),
    'X-Github-Hook-Id': getObjectString(headers, 'X-Github-Hook-Id'),
    'X-Github-Hook-Installation-Target-Id': getObjectString(headers, 'X-Github-Hook-Installation-Target-Id'),
    'X-Github-Hook-Installation-Target-Type': getObjectString(headers, 'X-Github-Hook-Installation-Target-Type'),
    'Accept-Encoding': getObjectString(headers, 'Accept-Encoding'),
  }
}

const normalizeResponseHeaders = (headers: unknown) => {
  return {
    'Content-Type': getObjectString(headers, 'Content-Type'),
    'Content-Length': getObjectString(headers, 'Content-Length'),
  }
}

const normalizeTriggerLog = (log: GeneratedRequestLog): TriggerLogEntity => {
  return {
    id: log.id,
    endpoint: log.endpoint,
    created_at: log.created_at,
    request: {
      method: getString(log.request.method),
      url: getString(log.request.url),
      headers: normalizeLogHeaders(log.request.headers),
      data: getString(log.request.data),
    },
    response: {
      status_code: getNumber(log.response.status_code),
      headers: normalizeResponseHeaders(log.response.headers),
      data: getString(log.response.data),
    },
  }
}

export const convertToTriggerWithProvider = (provider: TriggerProviderApiEntity): TriggerWithProvider => {
  return {
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
        default: param.default ?? '',
        options: param.options?.map(option => ({
          label: option.label,
          value: option.value,
        })) || [],
        multiple: param.multiple || false,
      })),
      labels: provider.tags || [],
      output_schema: event.output_schema || {},
    })),
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
    queryKey: consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }),
    queryFn: async () => {
      const response = await consoleClient.workspaces.current.triggers.get({})
      return response.map(normalizeTriggerProvider).map(convertToTriggerWithProvider)
    },
    enabled,
  })
}

export const useInvalidateAllTriggerPlugins = () => {
  return useInvalid(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }))
}

// ===== Trigger Subscriptions Management =====

export const useTriggerProviderInfo = (provider: string, enabled = true) => {
  return useQuery<TriggerProviderApiEntity>({
    queryKey: consoleQuery.workspaces.current.triggerProvider.byProvider.info.get.queryKey({ input: { params: { provider } } }),
    queryFn: async () => normalizeTriggerProvider(
      await consoleClient.workspaces.current.triggerProvider.byProvider.info.get({ params: { provider } }),
    ),
    enabled: enabled && !!provider,
  })
}

export const useTriggerSubscriptions = (provider: string, enabled = true) => {
  return useQuery<TriggerSubscription[]>({
    queryKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.list.get.queryKey({ input: { params: { provider } } }),
    queryFn: async () => {
      const response = await consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.list.get({ params: { provider } })
      return response.map(normalizeTriggerSubscription)
    },
    enabled: enabled && !!provider,
  })
}

export const useCreateTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.builder.create.post.mutationKey(),
    mutationFn: (payload: {
      provider: string
      credential_type?: string
    }) => {
      const { provider, ...body } = payload
      return consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.builder.create.post({
        params: { provider },
        body,
      }).then(response => ({
        subscription_builder: normalizeTriggerSubscriptionBuilder(response.subscription_builder),
      }))
    },
  })
}

export const useUpdateTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.builder.update.bySubscriptionBuilderId.post.mutationKey(),
    mutationFn: (payload: {
      provider: string
      subscriptionBuilderId: string
      name?: string
      properties?: Record<string, unknown>
      parameters?: Record<string, unknown>
      credentials?: Record<string, unknown>
    }) => {
      const { provider, subscriptionBuilderId, ...body } = payload
      return consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.builder.update.bySubscriptionBuilderId.post({
        params: { provider, subscription_builder_id: subscriptionBuilderId },
        body,
      }).then(normalizeTriggerSubscriptionBuilder)
    },
  })
}

export const useVerifyAndUpdateTriggerSubscriptionBuilder = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.builder.verifyAndUpdate.bySubscriptionBuilderId.post.mutationKey(),
    mutationFn: (payload: {
      provider: string
      subscriptionBuilderId: string
      credentials?: Record<string, unknown>
    }) => {
      const { provider, subscriptionBuilderId, credentials } = payload
      return consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.builder.verifyAndUpdate.bySubscriptionBuilderId.post({
        params: { provider, subscription_builder_id: subscriptionBuilderId },
        body: { credentials: credentials ?? {} },
      }, {
        context: { silent: true },
      })
    },
  })
}

export const useVerifyTriggerSubscription = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.verify.bySubscriptionId.post.mutationKey(),
    mutationFn: (payload: {
      provider: string
      subscriptionId: string
      credentials?: Record<string, unknown>
    }) => {
      const { provider, subscriptionId, credentials } = payload
      return consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.verify.bySubscriptionId.post({
        params: { provider, subscription_id: subscriptionId },
        body: { credentials: credentials ?? {} },
      }, {
        context: { silent: true },
      })
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
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.builder.build.bySubscriptionBuilderId.post.mutationKey(),
    mutationFn: (payload: BuildTriggerSubscriptionPayload) => {
      const { provider, subscriptionBuilderId, ...body } = payload
      return consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.builder.build.bySubscriptionBuilderId.post({
        params: { provider, subscription_builder_id: subscriptionBuilderId },
        body,
      })
    },
  })
}

export const useDeleteTriggerSubscription = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.bySubscriptionId.subscriptions.delete.post.mutationKey(),
    mutationFn: (subscriptionId: string) => {
      return consoleClient.workspaces.current.triggerProvider.bySubscriptionId.subscriptions.delete.post({
        params: { subscription_id: subscriptionId },
      })
    },
  })
}

type UpdateTriggerSubscriptionPayload = {
  subscriptionId: string
  name?: string
  properties?: Record<string, unknown>
  parameters?: Record<string, unknown>
  credentials?: Record<string, unknown>
}

export const useUpdateTriggerSubscription = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.bySubscriptionId.subscriptions.update.post.mutationKey(),
    mutationFn: (payload: UpdateTriggerSubscriptionPayload) => {
      const { subscriptionId, ...body } = payload
      return consoleClient.workspaces.current.triggerProvider.bySubscriptionId.subscriptions.update.post({
        params: { subscription_id: subscriptionId },
        body,
      })
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
    queryKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.builder.logs.bySubscriptionBuilderId.get.queryKey({
      input: { params: { provider, subscription_builder_id: subscriptionBuilderId } },
    }),
    queryFn: async () => {
      const response = await consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.builder.logs.bySubscriptionBuilderId.get({
        params: { provider, subscription_builder_id: subscriptionBuilderId },
      })
      return {
        logs: response.logs.map(normalizeTriggerLog),
      }
    },
    enabled: enabled && !!provider && !!subscriptionBuilderId,
    refetchInterval,
  })
}

// ===== OAuth Management =====
export const useTriggerOAuthConfig = (provider: string, enabled = true) => {
  return useQuery<TriggerOAuthConfig>({
    queryKey: consoleQuery.workspaces.current.triggerProvider.byProvider.oauth.client.get.queryKey({ input: { params: { provider } } }),
    queryFn: async () => normalizeTriggerOAuthConfig(
      await consoleClient.workspaces.current.triggerProvider.byProvider.oauth.client.get({ params: { provider } }),
    ),
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
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.oauth.client.post.mutationKey(),
    mutationFn: (payload: ConfigureTriggerOAuthPayload) => {
      const { provider, ...body } = payload
      return consoleClient.workspaces.current.triggerProvider.byProvider.oauth.client.post({
        params: { provider },
        body,
      })
    },
  })
}

export const useDeleteTriggerOAuth = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.oauth.client.delete.mutationKey(),
    mutationFn: (provider: string) => {
      return consoleClient.workspaces.current.triggerProvider.byProvider.oauth.client.delete({
        params: { provider },
      })
    },
  })
}

export const useInitiateTriggerOAuth = () => {
  return useMutation({
    mutationKey: consoleQuery.workspaces.current.triggerProvider.byProvider.subscriptions.oauth.authorize.get.mutationKey(),
    mutationFn: async (provider: string) => {
      const response = await consoleClient.workspaces.current.triggerProvider.byProvider.subscriptions.oauth.authorize.get({
        params: { provider },
      }, {
        context: { silent: true },
      })
      return {
        authorization_url: response.authorization_url,
        subscription_builder: normalizeTriggerSubscriptionBuilder(response.subscription_builder),
      }
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
    queryFn: async () => {
      if (payload.credentials) {
        return normalizeDynamicOptionsResponse(
          await consoleClient.workspaces.current.plugin.parameters.dynamicOptionsWithCredentials.post({
            body: {
              action: payload.action,
              credential_id: payload.credential_id,
              credentials: payload.credentials,
              parameter: payload.parameter,
              plugin_id: payload.plugin_id,
              provider: payload.provider,
            },
          }, {
            context: { silent: true },
          }),
        )
      }

      return normalizeDynamicOptionsResponse(
        await consoleClient.workspaces.current.plugin.parameters.dynamicOptions.get({
          query: {
            action: payload.action,
            credential_id: payload.credential_id,
            parameter: payload.parameter,
            plugin_id: payload.plugin_id,
            provider: payload.provider,
            provider_type: 'trigger',
          },
        }, {
          context: { silent: true },
        }),
      )
    },
    enabled: enabled && !!payload.plugin_id && !!payload.provider && !!payload.action && !!payload.parameter && !!payload.credential_id,
    retry: 0,
    staleTime: 0,
  })
}

// ===== Cache Invalidation Helpers =====
