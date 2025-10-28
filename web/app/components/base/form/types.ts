import type {
  ForwardedRef,
  ReactNode,
} from 'react'
import type {
  AnyFormApi,
  FieldValidators,
} from '@tanstack/react-form'

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
  checkbox = 'checkbox',
  files = 'files',
  file = 'file',
  modelSelector = 'model-selector',
  toolSelector = 'tool-selector',
  multiToolSelector = 'array[tools]',
  appSelector = 'app-selector',
  dynamicSelect = 'dynamic-select',
  boolean = 'boolean',
}

export type FormOption = {
  label: TypeWithI18N | string
  value: string
  show_on?: FormShowOnObject[]
  icon?: string
}

export type AnyValidators = FieldValidators<any, any, any, any, any, any, any, any, any, any, any, any>

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
  help?: string | TypeWithI18N
  placeholder?: string | TypeWithI18N
  options?: FormOption[]
  labelClassName?: string
  validators?: AnyValidators
  showRadioUI?: boolean
  disabled?: boolean
}

export type FormValues = Record<string, any>

export type GetValuesOptions = {
  needTransformWhenSecretFieldIsPristine?: boolean
  needCheckValidatedValues?: boolean
}
export type FormRefObject = {
  getForm: () => AnyFormApi
  getFormValues: (obj: GetValuesOptions) => {
    values: Record<string, any>
    isCheckValidated: boolean
  }
}
export type FormRef = ForwardedRef<FormRefObject>
