import type { ReactElement } from 'react'
import type { ValidateCallback } from '../key-validator/declarations'

export type FormValue = Record<string, string | boolean>

export type TypeWithI18N<T = string> = {
  'en': T
  'zh-Hans': T
}

export type Option = {
  key: string
  label: TypeWithI18N
}

export type Field = {
  visible: (v?: FormValue) => boolean
  type: string
  key: string
  required?: boolean
  obfuscated?: boolean
  switch?: boolean
  switchKey?: string
  label: TypeWithI18N
  options?: Option[]
  placeholder?: TypeWithI18N
  help?: TypeWithI18N
  validate?: ValidateCallback
  onFocus?: (newValue: FormValue, originValue?: FormValue, dispatch?: any) => void
}

export enum ModelEnum {
  'openai' = 'openai',
  'anthropic' = 'anthropic',
  'replicate' = 'replicate',
  'azure_openai' = 'azure_openai',
  'huggingface_hub' = 'huggingface_hub',
  'tongyi' = 'tongyi',
  'spark' = 'spark',
  'minimax' = 'minimax',
  'chatglm' = 'chatglm',
}

export type ModelItem = {
  key: ModelEnum
  titleIcon: TypeWithI18N<ReactElement>
  subTitleIcon?: ReactElement
  desc?: TypeWithI18N
  bgColor?: string
  hit?: TypeWithI18N
  vender?: TypeWithI18N
  disable?: {
    tip: TypeWithI18N
    link: {
      href: TypeWithI18N
      label: TypeWithI18N
    }
  }
}

export type ModelModal = {
  title: TypeWithI18N
  icon: ReactElement
  defaultValue?: FormValue
  fields: Field[]
  link: {
    href: string
    label: TypeWithI18N
  }
}

export type ModelConfig = {
  key: ModelEnum
  item: ModelItem
  modal?: ModelModal
}

export enum PreferredProviderTypeEnum {
  'system' = 'system',
  'custom' = 'custom',
}
export enum ModelFlexibilityEnum {
  'fixed' = 'fixed',
  'configurable' = 'configurable',
}
export type ConfigurableModel = {
  model_name: string
  model_type: string
  config: Record<string, string>
  is_valid: boolean
}
export type CommonProvider = {
  provider_name: ModelEnum
  provider_type: PreferredProviderTypeEnum
  is_valid: boolean
  last_used: number
}
export type SystemTrialProvider = {
  quota_type: string
  quota_unit: string
  quota_limit: number
  quota_used: number
} & CommonProvider
export type SystemPaidProvider = SystemTrialProvider
export type CustomFixedProvider = {
  config: Record<string, string>
} & CommonProvider
export type CustomConfigurableProvider = {
  models: ConfigurableModel[]
} & CommonProvider
export type ModelProviderCommon = {
  preferred_provider_type: PreferredProviderTypeEnum
  model_flexibility: ModelFlexibilityEnum
}
export type SystemProvider = {
  providers: [SystemTrialProvider, SystemPaidProvider, CustomFixedProvider]
} & ModelProviderCommon

export type CustomAddProvider = {
  providers: [CustomConfigurableProvider]
} & ModelProviderCommon

export type CustomSetupProvider = {
  providers: [CustomFixedProvider]
} & ModelProviderCommon

export type ModelProvider = {
  [k in (ModelEnum.openai | ModelEnum.anthropic)]: SystemProvider
} & {
  [k in (ModelEnum.azure_openai | ModelEnum.replicate | ModelEnum.huggingface_hub)]: CustomAddProvider
} & {
  [k in (ModelEnum.tongyi | ModelEnum.minimax | ModelEnum.chatglm | ModelEnum.spark)]: CustomSetupProvider
}
