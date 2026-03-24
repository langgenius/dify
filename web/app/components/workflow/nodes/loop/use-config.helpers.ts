import type { ErrorHandleMode, Var } from '../../types'
import type { Condition, LoopNodeType, LoopVariable } from './types'
import { produce } from 'immer'
import { v4 as uuid4 } from 'uuid'
import { ValueType, VarType } from '../../types'
import { LogicalOperator } from './types'
import { getOperators } from './utils'

export const canUseAsLoopInput = (variable: Var) => {
  return [
    VarType.array,
    VarType.arrayString,
    VarType.arrayNumber,
    VarType.arrayObject,
    VarType.arrayFile,
  ].includes(variable.type)
}

export const updateErrorHandleMode = (
  inputs: LoopNodeType,
  mode: ErrorHandleMode,
) => produce(inputs, (draft) => {
  draft.error_handle_mode = mode
})

export const addBreakCondition = ({
  inputs,
  valueSelector,
  variable,
  isVarFileAttribute,
}: {
  inputs: LoopNodeType
  valueSelector: string[]
  variable: { type: VarType }
  isVarFileAttribute: boolean
}) => produce(inputs, (draft) => {
  if (!draft.break_conditions)
    draft.break_conditions = []

  draft.break_conditions.push({
    id: uuid4(),
    varType: variable.type,
    variable_selector: valueSelector,
    comparison_operator: getOperators(variable.type, isVarFileAttribute ? { key: valueSelector.slice(-1)[0] } : undefined)[0],
    value: variable.type === VarType.boolean ? 'false' : '',
  })
})

export const removeBreakCondition = (
  inputs: LoopNodeType,
  conditionId: string,
) => produce(inputs, (draft) => {
  draft.break_conditions = draft.break_conditions?.filter(item => item.id !== conditionId)
})

export const updateBreakCondition = (
  inputs: LoopNodeType,
  conditionId: string,
  condition: Condition,
) => produce(inputs, (draft) => {
  const targetCondition = draft.break_conditions?.find(item => item.id === conditionId)
  if (targetCondition)
    Object.assign(targetCondition, condition)
})

export const toggleConditionOperator = (inputs: LoopNodeType) => produce(inputs, (draft) => {
  draft.logical_operator = draft.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
})

export const addSubVariableCondition = (
  inputs: LoopNodeType,
  conditionId: string,
  key?: string,
) => produce(inputs, (draft) => {
  const condition = draft.break_conditions?.find(item => item.id === conditionId)
  if (!condition)
    return

  if (!condition.sub_variable_condition) {
    condition.sub_variable_condition = {
      logical_operator: LogicalOperator.and,
      conditions: [],
    }
  }

  const comparisonOperators = getOperators(VarType.string, { key: key || '' })
  condition.sub_variable_condition.conditions.push({
    id: uuid4(),
    key: key || '',
    varType: VarType.string,
    comparison_operator: comparisonOperators[0],
    value: '',
  })
})

export const removeSubVariableCondition = (
  inputs: LoopNodeType,
  conditionId: string,
  subConditionId: string,
) => produce(inputs, (draft) => {
  const condition = draft.break_conditions?.find(item => item.id === conditionId)
  if (!condition?.sub_variable_condition)
    return

  condition.sub_variable_condition.conditions = condition.sub_variable_condition.conditions
    .filter(item => item.id !== subConditionId)
})

export const updateSubVariableCondition = (
  inputs: LoopNodeType,
  conditionId: string,
  subConditionId: string,
  condition: Condition,
) => produce(inputs, (draft) => {
  const targetCondition = draft.break_conditions?.find(item => item.id === conditionId)
  const targetSubCondition = targetCondition?.sub_variable_condition?.conditions.find(item => item.id === subConditionId)
  if (targetSubCondition)
    Object.assign(targetSubCondition, condition)
})

export const toggleSubVariableConditionOperator = (
  inputs: LoopNodeType,
  conditionId: string,
) => produce(inputs, (draft) => {
  const targetCondition = draft.break_conditions?.find(item => item.id === conditionId)
  if (targetCondition?.sub_variable_condition) {
    targetCondition.sub_variable_condition.logical_operator
      = targetCondition.sub_variable_condition.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
  }
})

export const updateLoopCount = (
  inputs: LoopNodeType,
  value: number,
) => produce(inputs, (draft) => {
  draft.loop_count = value
})

export const addLoopVariable = (inputs: LoopNodeType) => produce(inputs, (draft) => {
  if (!draft.loop_variables)
    draft.loop_variables = []

  draft.loop_variables.push({
    id: uuid4(),
    label: '',
    var_type: VarType.string,
    value_type: ValueType.constant,
    value: '',
  })
})

export const removeLoopVariable = (
  inputs: LoopNodeType,
  id: string,
) => produce(inputs, (draft) => {
  draft.loop_variables = draft.loop_variables?.filter(item => item.id !== id)
})

export const updateLoopVariable = (
  inputs: LoopNodeType,
  id: string,
  updateData: Partial<LoopVariable>,
) => produce(inputs, (draft) => {
  const index = draft.loop_variables?.findIndex(item => item.id === id) ?? -1
  if (index > -1) {
    draft.loop_variables![index] = {
      ...draft.loop_variables![index],
      ...updateData,
    }
  }
})
