import type {
  CredentialFormSchema as ContractCredentialFormSchema,
  FetchFrom,
  ModelFeature,
  ModelStatus,
  ModelType,
  ModelWithProviderEntityResponse,
  ParameterRule,
  ProviderResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { StaticImageData } from 'next/image'
import type {
  CredentialFormSchema,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  ModelItem,
  ModelParameterRule,
  ModelProvider,
  TypeWithI18N,
} from './declarations'
import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import openaiLogo from './assets/openai-small.svg'
import tongyiLogo from './assets/tongyi.svg'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  MODEL_TYPE_TEXT,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from './declarations'

export { ModelProviderQuotaGetPaid } from '@/types/model-provider'

export const MODEL_PROVIDER_QUOTA_GET_PAID = [
  ModelProviderQuotaGetPaid.OPENAI,
  ModelProviderQuotaGetPaid.ANTHROPIC,
  ModelProviderQuotaGetPaid.GEMINI,
  ModelProviderQuotaGetPaid.X,
  ModelProviderQuotaGetPaid.DEEPSEEK,
  ModelProviderQuotaGetPaid.TONGYI,
]

export const providerLogoMap: Record<
  ModelProviderQuotaGetPaid,
  { iconClassName: string } | { image: StaticImageData }
> = {
  [ModelProviderQuotaGetPaid.OPENAI]: { image: openaiLogo },
  [ModelProviderQuotaGetPaid.ANTHROPIC]: {
    iconClassName: 'i-custom-public-llm-anthropic-short-light',
  },
  [ModelProviderQuotaGetPaid.GEMINI]: { iconClassName: 'i-custom-public-llm-gemini' },
  [ModelProviderQuotaGetPaid.X]: { iconClassName: 'i-custom-public-llm-grok' },
  [ModelProviderQuotaGetPaid.DEEPSEEK]: { iconClassName: 'i-custom-public-llm-deepseek' },
  [ModelProviderQuotaGetPaid.TONGYI]: { image: tongyiLogo },
}

export const providerKeyToPluginId: Record<ModelProviderQuotaGetPaid, string> = {
  [ModelProviderQuotaGetPaid.OPENAI]: 'langgenius/openai',
  [ModelProviderQuotaGetPaid.ANTHROPIC]: 'langgenius/anthropic',
  [ModelProviderQuotaGetPaid.GEMINI]: 'langgenius/gemini',
  [ModelProviderQuotaGetPaid.X]: 'langgenius/x',
  [ModelProviderQuotaGetPaid.DEEPSEEK]: 'langgenius/deepseek',
  [ModelProviderQuotaGetPaid.TONGYI]: 'langgenius/tongyi',
}

export const modelNameMap = {
  [ModelProviderQuotaGetPaid.OPENAI]: 'OpenAI',
  [ModelProviderQuotaGetPaid.ANTHROPIC]: 'Anthropic',
  [ModelProviderQuotaGetPaid.GEMINI]: 'Gemini',
  [ModelProviderQuotaGetPaid.X]: 'xAI',
  [ModelProviderQuotaGetPaid.DEEPSEEK]: 'DeepSeek',
  [ModelProviderQuotaGetPaid.TONGYI]: 'Tongyi',
}

export const isNullOrUndefined = (value: unknown): value is null | undefined => {
  return value === undefined || value === null
}

export const sizeFormat = (size: number) => {
  const remainder = Math.floor(size / 1000)
  if (remainder < 1) return `${size}`
  else return `${remainder}K`
}

export const modelTypeFormat = (modelType: string) => {
  if (modelType === ModelTypeEnum.textEmbedding) return 'TEXT EMBEDDING'

  return modelType.toLocaleUpperCase()
}

export const genModelTypeFormSchema = (
  modelTypes: ModelTypeEnum[],
): Omit<CredentialFormSchemaSelect, 'name'> => {
  return {
    type: FormTypeEnum.select,
    label: {
      zh_Hans: '模型类型',
      en_US: 'Model Type',
    },
    variable: '__model_type',
    default: modelTypes[0],
    required: true,
    show_on: [],
    options: modelTypes.map((modelType: ModelTypeEnum) => {
      return {
        value: modelType,
        label: {
          zh_Hans: MODEL_TYPE_TEXT[modelType],
          en_US: MODEL_TYPE_TEXT[modelType],
        },
        show_on: [],
      }
    }),
  }
}

export const genModelNameFormSchema = (
  model?: Pick<CredentialFormSchemaTextInput, 'label' | 'placeholder'>,
): Omit<CredentialFormSchemaTextInput, 'name'> => {
  return {
    type: FormTypeEnum.textInput,
    label: model?.label || {
      zh_Hans: '模型名称',
      en_US: 'Model Name',
    },
    variable: '__model_name',
    required: true,
    show_on: [],
    placeholder: model?.placeholder || {
      zh_Hans: '请输入模型名称',
      en_US: 'Please enter model name',
    },
  }
}

const modelTypeMap: Record<ModelType, ModelTypeEnum> = {
  llm: ModelTypeEnum.textGeneration,
  moderation: ModelTypeEnum.moderation,
  rerank: ModelTypeEnum.rerank,
  speech2text: ModelTypeEnum.speech2text,
  'text-embedding': ModelTypeEnum.textEmbedding,
  tts: ModelTypeEnum.tts,
}

const modelFeatureMap: Record<ModelFeature, ModelFeatureEnum> = {
  'agent-thought': ModelFeatureEnum.agentThought,
  audio: ModelFeatureEnum.audio,
  document: ModelFeatureEnum.document,
  'multi-tool-call': ModelFeatureEnum.multiToolCall,
  polling: ModelFeatureEnum.polling,
  'stream-tool-call': ModelFeatureEnum.streamToolCall,
  'structured-output': ModelFeatureEnum.StructuredOutput,
  'tool-call': ModelFeatureEnum.toolCall,
  video: ModelFeatureEnum.video,
  vision: ModelFeatureEnum.vision,
}

const fetchFromMap: Record<FetchFrom, ConfigurationMethodEnum> = {
  'customizable-model': ConfigurationMethodEnum.customizableModel,
  'predefined-model': ConfigurationMethodEnum.predefinedModel,
}

const modelStatusMap: Record<ModelStatus, ModelStatusEnum> = {
  active: ModelStatusEnum.active,
  'credential-removed': ModelStatusEnum.credentialRemoved,
  disabled: ModelStatusEnum.disabled,
  'no-configure': ModelStatusEnum.noConfigure,
  'no-permission': ModelStatusEnum.noPermission,
  'quota-exceeded': ModelStatusEnum.quotaExceeded,
}

const normalizeModelLabel = (label: ModelWithProviderEntityResponse['label']): TypeWithI18N => ({
  en_US: label.en_US,
  zh_Hans: label.zh_Hans ?? label.en_US,
})

const normalizeModelProperties = (
  modelProperties: ModelWithProviderEntityResponse['model_properties'],
): ModelItem['model_properties'] => {
  const normalized: ModelItem['model_properties'] = {}

  Object.entries(modelProperties).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number') normalized[key] = value
  })

  return normalized
}

const normalizeModelProviderModel = (model: ModelWithProviderEntityResponse): ModelItem => ({
  model: model.model,
  label: normalizeModelLabel(model.label),
  model_type: modelTypeMap[model.model_type],
  features: model.features?.map((feature) => modelFeatureMap[feature]),
  fetch_from: fetchFromMap[model.fetch_from],
  status: modelStatusMap[model.status],
  model_properties: normalizeModelProperties(model.model_properties),
  load_balancing_enabled: model.load_balancing_enabled ?? false,
  deprecated: model.deprecated,
  has_invalid_load_balancing_configs: model.has_invalid_load_balancing_configs,
})

export const normalizeModelProviderModelsResponse = (response: {
  data: ModelWithProviderEntityResponse[]
}): ModelItem[] => response.data.map(normalizeModelProviderModel)

const isParameterDefault = (value: unknown): value is ModelParameterRule['default'] =>
  typeof value === 'number' ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'))

export const normalizeModelParameterRule = (rule: ParameterRule): ModelParameterRule => ({
  name: rule.name,
  type: rule.type,
  label: normalizeModelLabel(rule.label),
  help: rule.help ? normalizeModelLabel(rule.help) : undefined,
  // `default` is untyped JSON in the console API response.
  default: isParameterDefault(rule.default) ? rule.default : undefined,
  min: rule.min ?? undefined,
  max: rule.max ?? undefined,
  precision: rule.precision ?? undefined,
  required: rule.required,
  use_template: rule.use_template ?? undefined,
  options: rule.options,
})

export const modelParameterRulesQueryOptions = ({
  provider,
  model,
  enabled = true,
}: {
  provider?: string
  model?: string
  enabled?: boolean
}) =>
  consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.queryOptions({
    input: provider && model && enabled ? { params: { provider }, query: { model } } : skipToken,
    context: { silent: true },
    select: (response) => ({ data: response.data.map(normalizeModelParameterRule) }),
  })

const normalizeCredentialFormSchema = (
  schema: ContractCredentialFormSchema,
): CredentialFormSchema => ({
  name: schema.variable,
  variable: schema.variable,
  type: schema.type,
  label: normalizeModelLabel(schema.label),
  required: schema.required ?? false,
  default: schema.default,
  show_on: schema.show_on ?? [],
  max_length: schema.max_length,
  placeholder: schema.placeholder ? normalizeModelLabel(schema.placeholder) : undefined,
  options: (schema.options ?? []).map((option) => ({
    label: normalizeModelLabel(option.label),
    value: option.value,
    show_on: option.show_on ?? [],
  })),
})

const normalizeModelProvider = (provider: ProviderResponse): ModelProvider => {
  const { custom_configuration: customConfiguration } = provider
  const modelCredentialSchema = provider.model_credential_schema
  return {
    provider: provider.provider,
    label: normalizeModelLabel(provider.label),
    description: provider.description ? normalizeModelLabel(provider.description) : undefined,
    help: provider.help
      ? {
          title: normalizeModelLabel(provider.help.title),
          url: normalizeModelLabel(provider.help.url),
        }
      : undefined,
    icon_small: provider.icon_small ? normalizeModelLabel(provider.icon_small) : undefined,
    icon_small_dark: provider.icon_small_dark
      ? normalizeModelLabel(provider.icon_small_dark)
      : undefined,
    background: provider.background ?? undefined,
    supported_model_types: provider.supported_model_types.map((type) => modelTypeMap[type]),
    configurate_methods: provider.configurate_methods.map((method) => fetchFromMap[method]),
    provider_credential_schema: provider.provider_credential_schema
      ? {
          credential_form_schemas: provider.provider_credential_schema.credential_form_schemas.map(
            normalizeCredentialFormSchema,
          ),
        }
      : undefined,
    model_credential_schema: modelCredentialSchema
      ? {
          model: {
            label: normalizeModelLabel(modelCredentialSchema.model.label),
            placeholder: normalizeModelLabel(
              modelCredentialSchema.model.placeholder ?? modelCredentialSchema.model.label,
            ),
          },
          credential_form_schemas: modelCredentialSchema.credential_form_schemas.map(
            normalizeCredentialFormSchema,
          ),
        }
      : undefined,
    preferred_provider_type: provider.preferred_provider_type,
    custom_configuration: {
      status: customConfiguration.status,
      current_credential_id: customConfiguration.current_credential_id ?? undefined,
      current_credential_name: customConfiguration.current_credential_name ?? undefined,
      available_credentials: customConfiguration.available_credentials ?? undefined,
      custom_models: customConfiguration.custom_models?.map((model) => ({
        model: model.model,
        model_type: modelTypeMap[model.model_type],
        credentials: model.credentials ?? undefined,
        available_model_credentials: model.available_model_credentials,
        current_credential_id: model.current_credential_id ?? undefined,
        current_credential_name: model.current_credential_name ?? undefined,
      })),
      can_added_models: customConfiguration.can_added_models?.map((model) => ({
        model: model.model,
        model_type: modelTypeMap[model.model_type],
      })),
    },
    system_configuration: {
      enabled: provider.system_configuration.enabled,
      current_quota_type: provider.system_configuration.current_quota_type ?? undefined,
      quota_configurations: provider.system_configuration.quota_configurations ?? [],
    },
  }
}

// ModelProvider is the UI's view of the provider list, with credential schemas as form schemas.
export const modelProviderDetailsQueryOptions = () =>
  consoleQuery.workspaces.current.modelProviders.get.queryOptions({
    input: {},
    select: (response) => ({ data: response.data.map(normalizeModelProvider) }),
  })
