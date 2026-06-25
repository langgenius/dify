import type { ComponentType } from 'react'
import type {
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
} from './declarations'
import { AnthropicShortLight, Deepseek, Gemini, Grok, OpenaiSmall, Tongyi } from '@/app/components/base/icons/src/public/llm'

import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import {
  FormTypeEnum,
  MODEL_TYPE_TEXT,
  ModelTypeEnum,
} from './declarations'

export { ModelProviderQuotaGetPaid } from '@/types/model-provider'

export const providerToPluginId = (providerKey: string): string => {
  const lastSlash = providerKey.lastIndexOf('/')
  return lastSlash > 0 ? providerKey.slice(0, lastSlash) : ''
}

export const MODEL_PROVIDER_QUOTA_GET_PAID = [ModelProviderQuotaGetPaid.OPENAI, ModelProviderQuotaGetPaid.ANTHROPIC, ModelProviderQuotaGetPaid.GEMINI, ModelProviderQuotaGetPaid.X, ModelProviderQuotaGetPaid.DEEPSEEK, ModelProviderQuotaGetPaid.TONGYI]

export const providerIconMap: Record<ModelProviderQuotaGetPaid, ComponentType<{ className?: string }>> = {
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
  if (remainder < 1)
    return `${size}`
  else
    return `${remainder}K`
}

export const modelTypeFormat = (modelType: ModelTypeEnum) => {
  if (modelType === ModelTypeEnum.textEmbedding)
    return 'TEXT EMBEDDING'

  return modelType.toLocaleUpperCase()
}

export const genModelTypeFormSchema = (modelTypes: ModelTypeEnum[]): Omit<CredentialFormSchemaSelect, 'name'> => {
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

export const genModelNameFormSchema = (model?: Pick<CredentialFormSchemaTextInput, 'label' | 'placeholder'>): Omit<CredentialFormSchemaTextInput, 'name'> => {
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
