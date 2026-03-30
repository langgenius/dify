import type { InputVar } from '@/app/components/workflow/types'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import { InputVarType } from '@/app/components/workflow/types'
import { hasDuplicateStr } from '@/utils/var'

export type ExternalDataToolParams = {
  key: string
  type: string
  index: number
  name: string
  config?: PromptVariable['config']
  icon?: string
  icon_background?: string
}

export const ADD_EXTERNAL_DATA_TOOL = 'ADD_EXTERNAL_DATA_TOOL'

export const BASIC_INPUT_TYPES = new Set(['string', 'paragraph', 'select', 'number', 'checkbox'])

export const toInputVar = (item: PromptVariable): InputVar => ({
  ...item,
  label: item.name,
  variable: item.key,
  type: (item.type === 'string' ? InputVarType.textInput : item.type) as InputVarType,
  required: item.required ?? false,
})

export const buildPromptVariableFromInput = (payload: InputVar): PromptVariable => {
  const { variable, label, type, ...rest } = payload
  const nextType = type === InputVarType.textInput ? 'string' : type
  const nextItem: PromptVariable = {
    ...rest,
    type: nextType,
    key: variable,
    name: label as string,
  }

  if (payload.type !== InputVarType.select)
    delete nextItem.options

  return nextItem
}

export const getDuplicateError = (list: PromptVariable[]) => {
  if (hasDuplicateStr(list.map(item => item.key))) {
    return {
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.varName',
    }
  }
  if (hasDuplicateStr(list.map(item => item.name as string))) {
    return {
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.labelName',
    }
  }
  return null
}

export const buildPromptVariableFromExternalDataTool = (
  externalDataTool: ExternalDataTool,
  required: boolean,
): PromptVariable => ({
  key: externalDataTool.variable as string,
  name: externalDataTool.label as string,
  enabled: externalDataTool.enabled,
  type: externalDataTool.type as string,
  config: externalDataTool.config,
  required,
  icon: externalDataTool.icon,
  icon_background: externalDataTool.icon_background,
})

export const createPromptVariablesWithIds = (promptVariables: PromptVariable[]) => {
  return promptVariables.map((item) => {
    return {
      id: item.key,
      variable: { ...item },
    }
  })
}
