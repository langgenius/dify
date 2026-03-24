import type { ValueSelector, Var, VarType } from '../../types'
import type { Condition, Limit, ListFilterNodeType } from './types'
import { produce } from 'immer'
import { VarType as WorkflowVarType } from '../../types'
import { getOperators } from '../if-else/utils'
import { OrderBy } from './types'

export const getItemVarType = (varType?: VarType) => {
  switch (varType) {
    case WorkflowVarType.arrayNumber:
      return WorkflowVarType.number
    case WorkflowVarType.arrayString:
      return WorkflowVarType.string
    case WorkflowVarType.arrayFile:
      return WorkflowVarType.file
    case WorkflowVarType.arrayObject:
      return WorkflowVarType.object
    case WorkflowVarType.arrayBoolean:
      return WorkflowVarType.boolean
    default:
      return varType ?? WorkflowVarType.string
  }
}

export const getItemVarTypeShowName = (itemVarType?: VarType, hasVariable?: boolean) => {
  if (!hasVariable)
    return '?'

  const fallbackType = itemVarType || WorkflowVarType.string
  return `${fallbackType.substring(0, 1).toUpperCase()}${fallbackType.substring(1)}`
}

export const supportsSubVariable = (varType?: VarType) => varType === WorkflowVarType.arrayFile

export const canFilterVariable = (varPayload: Var) => {
  return [
    WorkflowVarType.arrayNumber,
    WorkflowVarType.arrayString,
    WorkflowVarType.arrayBoolean,
    WorkflowVarType.arrayFile,
  ].includes(varPayload.type)
}

export const buildFilterCondition = ({
  itemVarType,
  isFileArray,
  existingKey,
}: {
  itemVarType?: VarType
  isFileArray: boolean
  existingKey?: string
}): Condition => ({
  key: (isFileArray && !existingKey) ? 'name' : '',
  comparison_operator: getOperators(itemVarType, isFileArray ? { key: 'name' } : undefined)[0],
  value: itemVarType === WorkflowVarType.boolean ? false : '',
})

export const updateListFilterVariable = ({
  inputs,
  variable,
  varType,
  itemVarType,
}: {
  inputs: ListFilterNodeType
  variable: ValueSelector
  varType: VarType
  itemVarType: VarType
}) => produce(inputs, (draft) => {
  const isFileArray = varType === WorkflowVarType.arrayFile

  draft.variable = variable
  draft.var_type = varType
  draft.item_var_type = itemVarType
  draft.filter_by.conditions = [
    buildFilterCondition({
      itemVarType,
      isFileArray,
      existingKey: draft.filter_by.conditions[0]?.key,
    }),
  ]

  if (isFileArray && draft.order_by.enabled && !draft.order_by.key)
    draft.order_by.key = 'name'
})

export const updateFilterEnabled = (
  inputs: ListFilterNodeType,
  enabled: boolean,
) => produce(inputs, (draft) => {
  draft.filter_by.enabled = enabled
  if (enabled && !draft.filter_by.conditions)
    draft.filter_by.conditions = []
})

export const updateFilterCondition = (
  inputs: ListFilterNodeType,
  condition: Condition,
) => produce(inputs, (draft) => {
  draft.filter_by.conditions[0] = condition
})

export const updateLimit = (
  inputs: ListFilterNodeType,
  limit: Limit,
) => produce(inputs, (draft) => {
  draft.limit = limit
})

export const updateExtractEnabled = (
  inputs: ListFilterNodeType,
  enabled: boolean,
) => produce(inputs, (draft) => {
  draft.extract_by.enabled = enabled
  if (enabled)
    draft.extract_by.serial = '1'
})

export const updateExtractSerial = (
  inputs: ListFilterNodeType,
  value: string,
) => produce(inputs, (draft) => {
  draft.extract_by.serial = value
})

export const updateOrderByEnabled = (
  inputs: ListFilterNodeType,
  enabled: boolean,
  hasSubVariable: boolean,
) => produce(inputs, (draft) => {
  draft.order_by.enabled = enabled
  if (enabled) {
    draft.order_by.value = OrderBy.ASC
    if (hasSubVariable && !draft.order_by.key)
      draft.order_by.key = 'name'
  }
})

export const updateOrderByKey = (
  inputs: ListFilterNodeType,
  key: string,
) => produce(inputs, (draft) => {
  draft.order_by.key = key
})

export const updateOrderByType = (
  inputs: ListFilterNodeType,
  type: OrderBy,
) => produce(inputs, (draft) => {
  draft.order_by.value = type
})
