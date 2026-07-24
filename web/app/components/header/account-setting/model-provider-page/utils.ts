import type {
  FetchFrom,
  ModelFeature,
  ModelStatus,
  ModelType,
  ModelWithProviderEntityResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentType } from 'react'
import type {
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  ModelItem,
  TypeWithI18N,
} from './declarations'
import {
  AnthropicShortLight,
  Deepseek,
  Gemini,
  Grok,
  OpenaiSmall,
  Tongyi,
} from '@/app/components/base/icons/src/public/llm'
import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  MODEL_TYPE_TEXT,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from './declarations'

export { ModelProviderQuotaGetPaid } from '@/types/model-provider'

export const providerToPluginId = (providerKey: string): string => {
  const lastSlash = providerKey.lastIndexOf('/')
  return lastSlash > 0 ? providerKey.slice(0, lastSlash) : ''
}

export const MODEL_PROVIDER_QUOTA_GET_PAID = [
  ModelProviderQuotaGetPaid.OPENAI,
  ModelProviderQuotaGetPaid.ANTHROPIC,
  ModelProviderQuotaGetPaid.GEMINI,
  ModelProviderQuotaGetPaid.X,
  ModelProviderQuotaGetPaid.DEEPSEEK,
  ModelProviderQuotaGetPaid.TONGYI,
]

export const providerIconMap: Record<
  ModelProviderQuotaGetPaid,
  ComponentType<{ className?: string }>
> = {
  [ModelProviderQuotaGetPaid.OPENAI]: OpenaiSmall,
  [ModelProviderQuotaGetPaid.ANTHROPIC]: AnthropicShortLight,
  [ModelProviderQuotaGetPaid.GEMINI]: Gemini,
  [ModelProviderQuotaGetPaid.X]: Grok,
  [ModelProviderQuotaGetPaid.DEEPSEEK]: Deepseek,
  [ModelProviderQuotaGetPaid.TONGYI]: Tongyi,
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

export const modelTypeFormat = (modelType: ModelTypeEnum) => {
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
