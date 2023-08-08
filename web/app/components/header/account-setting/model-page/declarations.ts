import type { ReactElement } from 'react'
import type { ValidateCallback } from '../key-validator/declarations'

export type FormValue = Record<string, string | boolean>
export type I18NText = {
  'en': string
  'zh-Hans': string
}
export type Option = {
  key: string
  label: I18NText
}
export type Field = {
  visible: (v?: FormValue) => boolean
  type: string
  key: string
  required?: boolean
  obfuscated?: boolean
  switch?: boolean
  switchKey?: string
  label: I18NText
  options?: Option[]
  placeholder?: I18NText
  help?: I18NText
  validate?: ValidateCallback
}

export type Config = {
  hit?: I18NText
  title: I18NText
  vender?: I18NText
  link: {
    href: string
    label: I18NText
  }
  defaultValue?: FormValue
  fields: Field[]
}

export type TModelItem = {
  key: string
  icon: {
    'en': ReactElement
    'zh-Hans': ReactElement
  }
  modalIcon: ReactElement
  config: Config
}
export type ModelCard = {
  key: string
  bgColor: string
  iconText: ReactElement
  icon: ReactElement
  modalIcon: ReactElement
  config: Config
  desc: I18NText
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
export type TypeWithI18N<T = string> = {
  'en': T
  'zh-Hans': T
}
export type ModelItem = {
  titleIcon: TypeWithI18N<ReactElement>
  subTitleIcon?: ReactElement
  desc?: TypeWithI18N
  bgColor?: string
  hit?: TypeWithI18N
  vender?: TypeWithI18N
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
