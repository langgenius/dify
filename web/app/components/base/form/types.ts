import type {
  ForwardedRef,
  ReactNode,
} from 'react'
import type { AnyFormApi } from '@tanstack/react-form'

export type TypeWithI18N<T = string> = {
  en_US: T
  zh_Hans: T
  [key: string]: T
}

export type FormShowOnObject = {
  variable: string
  value: string
}

export enum FormTypeEnum {
  textInput = 'text-input',
  textNumber = 'number-input',
  secretInput = 'secret-input',
  select = 'select',
  radio = 'radio',
  boolean = 'boolean',
  files = 'files',
  file = 'file',
  modelSelector = 'model-selector',
  toolSelector = 'tool-selector',
  multiToolSelector = 'array[tools]',
  appSelector = 'app-selector',
  dynamicSelect = 'dynamic-select',
}

export type FormSchema = {
  type: FormTypeEnum
  name: string
  label: string | ReactNode | TypeWithI18N
  required: boolean
  default?: any
  tooltip?: string | TypeWithI18N
  show_on?: FormShowOnObject[]
  url?: string
  scope?: string
}

export type FormValues = Record<string, any>

export type FromRefObject = {
    getForm: () => AnyFormApi
}
export type FormRef = ForwardedRef<FromRefObject>
