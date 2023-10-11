import type { ReactElement } from 'react'
import type { ModelModeType } from '@/types/app'

export type FormValue = Record<string, string>

export type TypeWithI18N<T = string> = {
  'en': T
  'zh-Hans': T
}

export type Option = {
  key: string
  label: TypeWithI18N
}

export type ProviderSelector = {
  name: TypeWithI18N
  icon: ReactElement
}

export type Field = {
  hidden?: (v?: FormValue) => boolean
  type: string
  key: string
  required?: boolean
  label: TypeWithI18N
  options?: Option[] | ((v: FormValue) => Option[])
  placeholder?: TypeWithI18N
  help?: TypeWithI18N
}

export enum ProviderEnum {
  'openai' = 'openai',
  'anthropic' = 'anthropic',
  'replicate' = 'replicate',
  'azure_openai' = 'azure_openai',
  'huggingface_hub' = 'huggingface_hub',
  'tongyi' = 'tongyi',
  'wenxin' = 'wenxin',
  'spark' = 'spark',
  'minimax' = 'minimax',
  'chatglm' = 'chatglm',
  'xinference' = 'xinference',
  'openllm' = 'openllm',
  'localai' = 'localai',
  'zhipuai' = 'zhipuai',
  'baichuan' = 'baichuan',
}

export type ProviderConfigItem = {
  key: ProviderEnum
  titleIcon: TypeWithI18N<ReactElement>
  subTitleIcon?: ReactElement
  desc?: TypeWithI18N
  bgColor?: string
  hit?: TypeWithI18N
  disable?: {
    tip: TypeWithI18N
    link: {
      href: TypeWithI18N
      label: TypeWithI18N
    }
  }
}

export enum ModelType {
  textGeneration = 'text-generation',
  embeddings = 'embeddings',
  speech2text = 'speech2text',
}

export enum ModelFeature {
  agentThought = 'agent_thought',
}

// backend defined model struct: /console/api/workspaces/current/models/model-type/:model_type
export type BackendModel = {
  model_name: string
  model_display_name: string // not always exist
  model_type: ModelType
  model_mode: ModelModeType
  model_provider: {
    provider_name: ProviderEnum
    provider_type: PreferredProviderTypeEnum
    quota_type: 'trial' | 'paid'
    quota_unit: 'times' | 'tokens'
    quota_used: number
    quota_limit: number
  }
  features: ModelFeature[]
}

export type ProviderConfigModal = {
  key: ProviderEnum
  title: TypeWithI18N
  icon: ReactElement
  defaultValue?: FormValue
  validateKeys?: string[] | ((v?: FormValue) => string[])
  filterValue?: (v?: FormValue) => FormValue
  fields: Field[]
  link: {
    href: string
    label: TypeWithI18N
  }
}

export type ProviderConfig = {
  selector: ProviderSelector
  item: ProviderConfigItem
  modal: ProviderConfigModal
}

export enum PreferredProviderTypeEnum {
  'system' = 'system',
  'custom' = 'custom',
}
export enum ModelFlexibilityEnum {
  'fixed' = 'fixed',
  'configurable' = 'configurable',
}

export type ProviderCommon = {
  provider_name: ProviderEnum
  provider_type: PreferredProviderTypeEnum
  is_valid: boolean
  last_used: number
}

export type ProviderWithQuota = {
  quota_type: string
  quota_unit: string
  quota_limit: number
  quota_used: number
} & ProviderCommon

export type ProviderWithConfig = {
  config: Record<string, string>
} & ProviderCommon

export type Model = {
  model_name: string
  model_type: string
  config: Record<string, string>
}

export type ProviderWithModels = {
  models: Model[]
} & ProviderCommon

export type ProviderInstance = ProviderWithQuota | ProviderWithConfig | ProviderWithModels

export type Provider = {
  preferred_provider_type: PreferredProviderTypeEnum
  model_flexibility: ModelFlexibilityEnum
  providers: ProviderInstance[]
}
export type ProviderMap = {
  [k in ProviderEnum]: Provider
}
