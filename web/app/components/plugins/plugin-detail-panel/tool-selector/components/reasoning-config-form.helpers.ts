import type { Node } from 'reactflow'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'

export type ReasoningConfigInputValue = {
  type?: VarKindType
  value?: unknown
  [key: string]: unknown
} | null

export type ReasoningConfigInput = {
  value: ReasoningConfigInputValue
  auto?: 0 | 1
}

export type ReasoningConfigValue = Record<string, ReasoningConfigInput>

export const getVarKindType = (type: string) => {
  if (type === FormTypeEnum.file || type === FormTypeEnum.files)
    return VarKindType.variable

  if ([FormTypeEnum.select, FormTypeEnum.checkbox, FormTypeEnum.textNumber, FormTypeEnum.array, FormTypeEnum.object].includes(type as FormTypeEnum))
    return VarKindType.constant

  if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
    return VarKindType.mixed

  return undefined
}

export const resolveTargetVarType = (type: string) => {
  if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
    return VarType.string
  if (type === FormTypeEnum.textNumber)
    return VarType.number
  if (type === FormTypeEnum.files)
    return VarType.arrayFile
  if (type === FormTypeEnum.file)
    return VarType.file
  if (type === FormTypeEnum.checkbox)
    return VarType.boolean
  if (type === FormTypeEnum.object)
    return VarType.object
  if (type === FormTypeEnum.array)
    return VarType.arrayObject

  return VarType.string
}

export const createFilterVar = (type: string) => {
  if (type === FormTypeEnum.textNumber)
    return (varPayload: Var) => varPayload.type === VarType.number

  if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
    return (varPayload: Var) => [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)

  if (type === FormTypeEnum.file || type === FormTypeEnum.files)
    return (varPayload: Var) => [VarType.file, VarType.arrayFile].includes(varPayload.type)

  if (type === FormTypeEnum.checkbox)
    return (varPayload: Var) => varPayload.type === VarType.boolean

  if (type === FormTypeEnum.object)
    return (varPayload: Var) => varPayload.type === VarType.object

  if (type === FormTypeEnum.array)
    return (varPayload: Var) => [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)

  return undefined
}

export const getVisibleSelectOptions = (
  options: NonNullable<ToolFormSchema['options']>,
  value: ReasoningConfigValue,
  language: string,
) => {
  return options.filter((option) => {
    if (option.show_on.length)
      return option.show_on.every(showOnItem => value[showOnItem.variable]?.value?.value === showOnItem.value)

    return true
  }).map(option => ({
    value: option.value,
    name: option.label[language] || option.label.en_US,
  }))
}

export const updateInputAutoState = (
  value: ReasoningConfigValue,
  variable: string,
  enabled: boolean,
  type: string,
) => {
  return {
    ...value,
    [variable]: {
      value: enabled ? null : { type: getVarKindType(type), value: null },
      auto: enabled ? 1 as const : 0 as const,
    },
  }
}

export const updateVariableTypeValue = (
  value: ReasoningConfigValue,
  variable: string,
  newType: VarKindType,
  defaultValue: unknown,
) => {
  return produce(value, (draft) => {
    draft[variable]!.value = {
      type: newType,
      value: newType === VarKindType.variable ? '' : defaultValue,
    }
  })
}

export const updateReasoningValue = (
  value: ReasoningConfigValue,
  variable: string,
  type: string,
  newValue: unknown,
) => {
  return produce(value, (draft) => {
    draft[variable]!.value = {
      type: getVarKindType(type),
      value: newValue,
    }
  })
}

export const mergeReasoningValue = (
  value: ReasoningConfigValue,
  variable: string,
  newValue: Record<string, unknown>,
) => {
  return produce(value, (draft) => {
    const currentValue = draft[variable]!.value as Record<string, unknown> | undefined
    draft[variable]!.value = {
      ...currentValue,
      ...newValue,
    }
  })
}

export const updateVariableSelectorValue = (
  value: ReasoningConfigValue,
  variable: string,
  newValue: ValueSelector | string,
) => {
  return produce(value, (draft) => {
    draft[variable]!.value = {
      type: VarKindType.variable,
      value: newValue,
    }
  })
}

export const getFieldFlags = (type: string, varInput?: ReasoningConfigInputValue) => {
  const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const isNumber = type === FormTypeEnum.textNumber
  const isObject = type === FormTypeEnum.object
  const isArray = type === FormTypeEnum.array
  const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
  const isBoolean = type === FormTypeEnum.checkbox
  const isSelect = type === FormTypeEnum.select
  const isAppSelector = type === FormTypeEnum.appSelector
  const isModelSelector = type === FormTypeEnum.modelSelector
  const isConstant = varInput?.type === VarKindType.constant || !varInput?.type

  return {
    isString,
    isNumber,
    isObject,
    isArray,
    isShowJSONEditor: isObject || isArray,
    isFile,
    isBoolean,
    isSelect,
    isAppSelector,
    isModelSelector,
    showTypeSwitch: isNumber || isObject || isArray,
    isConstant,
    showVariableSelector: isFile || varInput?.type === VarKindType.variable,
  }
}

export const createPickerProps = ({
  type,
  value,
  language,
  schema,
}: {
  type: string
  value: ReasoningConfigValue
  language: string
  schema: ToolFormSchema
}) => {
  return {
    filterVar: createFilterVar(type),
    schema: schema as Partial<CredentialFormSchema>,
    targetVarType: resolveTargetVarType(type),
    selectItems: schema.options ? getVisibleSelectOptions(schema.options, value, language) : [],
  }
}

export const getFieldTitle = (labels: { [key: string]: string }, language: string) => {
  return labels[language] || labels.en_US
}

export const createEmptyAppValue = () => ({
  app_id: '',
  inputs: {},
  files: [],
})

export const createReasoningFormContext = ({
  availableNodes,
  nodeId,
  nodeOutputVars,
}: {
  availableNodes: Node[]
  nodeId: string
  nodeOutputVars: NodeOutPutVar[]
}) => ({
  availableNodes,
  nodeId,
  nodeOutputVars,
})
