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
  value: string | string[]
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
  textareaInput = 'textarea-input',
  promptInput = 'prompt-input',
  objectList = 'object-list',
  arrayList = 'array-list',
  jsonInput = 'json-input',
  collapse = 'collapse',
  editMode = 'edit-mode',
  boolean = 'boolean',
  booleanList = 'boolean-list',
  switch = 'switch',
  nodeSelector = 'node-selector', // used in memory variable form
}

export type FormOption = {
  label: TypeWithI18N | string
  value: string
  show_on?: FormShowOnObject[]
  icon?: string
}

export type AnyValidators = FieldValidators<any, any, any, any, any, any, any, any, any, any>

export type FormSchema = {
  type: FormTypeEnum | ((form: AnyFormApi) => FormTypeEnum)
  name: string
  label: string | ReactNode | TypeWithI18N
  required: boolean
  default?: any
  tooltip?: string | TypeWithI18N
  show_on?: FormShowOnObject[] | ((form: AnyFormApi) => FormShowOnObject[])
  more_on?: FormShowOnObject[] | ((form: AnyFormApi) => FormShowOnObject[])
  url?: string
  scope?: string
  help?: string | TypeWithI18N
  placeholder?: string | TypeWithI18N
  options?: FormOption[]
  fieldClassName?: string
  labelClassName?: string
  inputContainerClassName?: string
  inputClassName?: string
  validators?: AnyValidators
  selfFormProps?: ((form: AnyFormApi) => Record<string, any>) | Record<string, any>
  onChange?: (form: AnyFormApi, v: any) => void
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
