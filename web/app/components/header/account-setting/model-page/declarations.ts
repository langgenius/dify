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
