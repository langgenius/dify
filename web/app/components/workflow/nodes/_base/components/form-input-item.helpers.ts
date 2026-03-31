'use client'

import type { ResourceVarInputs } from '../types'
import type {
  CredentialFormSchema,
  FormOption,
  TypeWithI18N,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType } from '@/app/components/workflow/types'
import { VarKindType } from '../types'

type FormInputSchema = CredentialFormSchema & Partial<{
  _type: FormTypeEnum
  multiple: boolean
  options: FormOption[]
  placeholder: TypeWithI18N
  scope: string
}>

type FormInputValue = ResourceVarInputs[string] | undefined

type ShowOnCondition = {
  value: unknown
  variable: string
}

type OptionLabel = string | TypeWithI18N

type SelectableOption = {
  icon?: string
  label: OptionLabel
  show_on?: ShowOnCondition[]
  value: string
}

export type SelectItem = {
  icon?: string
  name: string
  value: string
}

export type FormInputState = {
  defaultValue: unknown
  isAppSelector: boolean
  isArray: boolean
  isBoolean: boolean
  isCheckbox: boolean
  isConstant: boolean
  isDynamicSelect: boolean
  isFile: boolean
  isFiles: boolean
  isModelSelector: boolean
  isMultipleSelect: boolean
  isNumber: boolean
  isObject: boolean
  isSelect: boolean
  isShowJSONEditor: boolean
  isString: boolean
  options: FormOption[]
  placeholder?: TypeWithI18N
  scope?: string
  showVariableSelector: boolean
  showTypeSwitch: boolean
  variable: string
}

const optionMatchesValue = (
  values: ResourceVarInputs,
  showOnItem: ShowOnCondition,
) => values[showOnItem.variable]?.value === showOnItem.value || values[showOnItem.variable] === showOnItem.value

const getOptionLabel = (option: SelectableOption, language: string) => {
  if (typeof option.label === 'string')
    return option.label

  return option.label[language] || option.label.en_US || option.value
}

export const getFormInputState = (
  schema: FormInputSchema,
  varInput: FormInputValue,
): FormInputState => {
  const {
    default: defaultValue,
    multiple = false,
    options = [],
    placeholder,
    scope,
    type,
    variable,
    _type,
  } = schema

  const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const isNumber = type === FormTypeEnum.textNumber
  const isObject = type === FormTypeEnum.object
  const isArray = type === FormTypeEnum.array
  const isShowJSONEditor = isObject || isArray
  const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
  const isFiles = type === FormTypeEnum.files
  const isBoolean = _type === FormTypeEnum.boolean
  const isCheckbox = _type === FormTypeEnum.checkbox
  const isSelect = type === FormTypeEnum.select
  const isDynamicSelect = type === FormTypeEnum.dynamicSelect
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const showTypeSwitch = isNumber || isBoolean || isObject || isArray || isSelect
  const isConstant = varInput?.type === VarKindType.constant || !varInput?.type
  const showVariableSelector = isFile || varInput?.type === VarKindType.variable
  const isMultipleSelect = multiple && (isSelect || isDynamicSelect)

  return {
    defaultValue,
    isAppSelector,
    isArray,
    isBoolean,
    isCheckbox,
    isConstant,
    isDynamicSelect,
    isFile,
    isFiles,
    isModelSelector,
    isMultipleSelect,
    isNumber,
    isObject,
    isSelect,
    isShowJSONEditor,
    isString,
    options,
    placeholder,
    scope,
    showTypeSwitch,
    showVariableSelector,
    variable,
  }
}

export const getTargetVarType = (state: FormInputState) => {
  if (state.isString)
    return VarType.string
  if (state.isNumber)
    return VarType.number
  if (state.isFile)
    return state.isFiles ? VarType.arrayFile : VarType.file
  if (state.isSelect)
    return VarType.string
  if (state.isBoolean)
    return VarType.boolean
  if (state.isObject)
    return VarType.object
  if (state.isArray)
    return VarType.arrayObject
  return VarType.string
}

export const getFilterVar = (state: FormInputState) => {
  if (state.isNumber)
    return (varPayload: Var) => varPayload.type === VarType.number
  if (state.isString)
    return (varPayload: Var) => [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
  if (state.isFile)
    return (varPayload: Var) => [VarType.file, VarType.arrayFile].includes(varPayload.type)
  if (state.isBoolean)
    return (varPayload: Var) => varPayload.type === VarType.boolean
  if (state.isObject)
    return (varPayload: Var) => varPayload.type === VarType.object
  if (state.isArray)
    return (varPayload: Var) => [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)
  return undefined
}

export const getVarKindType = (state: FormInputState) => {
  if (state.isFile)
    return VarKindType.variable
  if (state.isSelect || state.isDynamicSelect || state.isBoolean || state.isNumber || state.isArray || state.isObject)
    return VarKindType.constant
  if (state.isString)
    return VarKindType.mixed
  return undefined
}

export const filterVisibleOptions = (
  options: SelectableOption[],
  values: ResourceVarInputs,
) => options.filter((option) => {
  if (option.show_on?.length)
    return option.show_on.every(showOnItem => optionMatchesValue(values, showOnItem))
  return true
})

export const mapSelectItems = (
  options: SelectableOption[],
  language: string,
): SelectItem[] => options.map(option => ({
  icon: option.icon,
  name: getOptionLabel(option, language),
  value: option.value,
}))

export const hasOptionIcon = (options: SelectableOption[]) => options.some(option => !!option.icon)

export const getSelectedLabels = (
  selectedValues: string[] | undefined,
  options: SelectableOption[],
  language: string,
) => {
  if (!selectedValues?.length)
    return ''

  const selectedOptions = options.filter(option => selectedValues.includes(option.value))
  if (selectedOptions.length <= 2) {
    return selectedOptions
      .map(option => getOptionLabel(option, language))
      .join(', ')
  }

  return `${selectedOptions.length} selected`
}

export const getCheckboxListOptions = (
  options: SelectableOption[],
  language: string,
) => options.map(option => ({
  label: getOptionLabel(option, language),
  value: option.value,
}))

export const getCheckboxListValue = (
  currentValue: unknown,
  defaultValue: unknown,
  availableOptions: SelectableOption[],
) => {
  let current: string[] = []

  if (Array.isArray(currentValue))
    current = currentValue as string[]
  else if (typeof currentValue === 'string')
    current = [currentValue]
  else if (Array.isArray(defaultValue))
    current = defaultValue as string[]

  const allowedValues = new Set(availableOptions.map(option => option.value))
  return current.filter(item => allowedValues.has(item))
}

export const getNumberInputValue = (currentValue: unknown): number | string => {
  if (typeof currentValue === 'number')
    return Number.isNaN(currentValue) ? '' : currentValue

  if (typeof currentValue === 'string')
    return currentValue

  return ''
}

export const normalizeVariableSelectorValue = (value: ValueSelector | string) =>
  value || ''
