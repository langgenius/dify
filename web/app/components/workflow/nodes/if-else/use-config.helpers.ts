import type { Branch, Var } from '../../types'
import type { CaseItem, Condition, IfElseNodeType } from './types'
import { produce } from 'immer'
import { v4 as uuid4 } from 'uuid'
import { VarType } from '../../types'
import { LogicalOperator } from './types'
import {
  branchNameCorrect,
  getOperators,
} from './utils'

export const filterAllVars = () => true

export const filterNumberVars = (varPayload: Var) => varPayload.type === VarType.number

export const getVarsIsVarFileAttribute = (
  cases: IfElseNodeType['cases'],
  getIsVarFileAttribute: (valueSelector: string[]) => boolean,
) => {
  const conditions: Record<string, boolean> = {}
  cases?.forEach((caseItem) => {
    caseItem.conditions.forEach((condition) => {
      if (condition.variable_selector)
        conditions[condition.id] = getIsVarFileAttribute(condition.variable_selector)
    })
  })
  return conditions
}

const getTargetBranchesWithNewCase = (targetBranches: Branch[] | undefined, caseId: string) => {
  if (!targetBranches)
    return targetBranches

  const elseCaseIndex = targetBranches.findIndex(branch => branch.id === 'false')
  if (elseCaseIndex < 0)
    return targetBranches

  return branchNameCorrect([
    ...targetBranches.slice(0, elseCaseIndex),
    {
      id: caseId,
      name: '',
    },
    ...targetBranches.slice(elseCaseIndex),
  ])
}

export const addCase = (inputs: IfElseNodeType) => produce(inputs, (draft) => {
  if (!draft.cases)
    return

  const caseId = uuid4()
  draft.cases.push({
    case_id: caseId,
    logical_operator: LogicalOperator.and,
    conditions: [],
  })
  draft._targetBranches = getTargetBranchesWithNewCase(draft._targetBranches, caseId)
})

export const removeCase = (
  inputs: IfElseNodeType,
  caseId: string,
) => produce(inputs, (draft) => {
  draft.cases = draft.cases?.filter(item => item.case_id !== caseId)

  if (draft._targetBranches)
    draft._targetBranches = branchNameCorrect(draft._targetBranches.filter(branch => branch.id !== caseId))
})

export const sortCases = (
  inputs: IfElseNodeType,
  newCases: (CaseItem & { id: string })[],
) => produce(inputs, (draft) => {
  draft.cases = newCases.filter(Boolean).map(item => ({
    id: item.id,
    case_id: item.case_id,
    logical_operator: item.logical_operator,
    conditions: item.conditions,
  }))

  draft._targetBranches = branchNameCorrect([
    ...newCases.filter(Boolean).map(item => ({ id: item.case_id, name: '' })),
    { id: 'false', name: '' },
  ])
})

export const addCondition = ({
  inputs,
  caseId,
  valueSelector,
  variable,
  isVarFileAttribute,
}: {
  inputs: IfElseNodeType
  caseId: string
  valueSelector: string[]
  variable: Var
  isVarFileAttribute: boolean
}) => produce(inputs, (draft) => {
  const targetCase = draft.cases?.find(item => item.case_id === caseId)
  if (!targetCase)
    return

  targetCase.conditions.push({
    id: uuid4(),
    varType: variable.type,
    variable_selector: valueSelector,
    comparison_operator: getOperators(variable.type, isVarFileAttribute ? { key: valueSelector.slice(-1)[0] } : undefined)[0],
    value: (variable.type === VarType.boolean || variable.type === VarType.arrayBoolean) ? false : '',
  })
})

export const removeCondition = (
  inputs: IfElseNodeType,
  caseId: string,
  conditionId: string,
) => produce(inputs, (draft) => {
  const targetCase = draft.cases?.find(item => item.case_id === caseId)
  if (targetCase)
    targetCase.conditions = targetCase.conditions.filter(item => item.id !== conditionId)
})

export const updateCondition = (
  inputs: IfElseNodeType,
  caseId: string,
  conditionId: string,
  nextCondition: Condition,
) => produce(inputs, (draft) => {
  const targetCondition = draft.cases
    ?.find(item => item.case_id === caseId)
    ?.conditions
    .find(item => item.id === conditionId)

  if (targetCondition)
    Object.assign(targetCondition, nextCondition)
})

export const toggleConditionLogicalOperator = (
  inputs: IfElseNodeType,
  caseId: string,
) => produce(inputs, (draft) => {
  const targetCase = draft.cases?.find(item => item.case_id === caseId)
  if (!targetCase)
    return

  targetCase.logical_operator = targetCase.logical_operator === LogicalOperator.and
    ? LogicalOperator.or
    : LogicalOperator.and
})

export const addSubVariableCondition = (
  inputs: IfElseNodeType,
  caseId: string,
  conditionId: string,
  key?: string,
) => produce(inputs, (draft) => {
  const condition = draft.cases
    ?.find(item => item.case_id === caseId)
    ?.conditions
    .find(item => item.id === conditionId)

  if (!condition)
    return

  if (!condition.sub_variable_condition) {
    condition.sub_variable_condition = {
      case_id: uuid4(),
      logical_operator: LogicalOperator.and,
      conditions: [],
    }
  }

  condition.sub_variable_condition.conditions.push({
    id: uuid4(),
    key: key || '',
    varType: VarType.string,
    comparison_operator: undefined,
    value: '',
  })
})

export const removeSubVariableCondition = (
  inputs: IfElseNodeType,
  caseId: string,
  conditionId: string,
  subConditionId: string,
) => produce(inputs, (draft) => {
  const subVariableCondition = draft.cases
    ?.find(item => item.case_id === caseId)
    ?.conditions
    .find(item => item.id === conditionId)
    ?.sub_variable_condition

  if (!subVariableCondition)
    return

  subVariableCondition.conditions = subVariableCondition.conditions.filter(item => item.id !== subConditionId)
})

export const updateSubVariableCondition = (
  inputs: IfElseNodeType,
  caseId: string,
  conditionId: string,
  subConditionId: string,
  nextCondition: Condition,
) => produce(inputs, (draft) => {
  const targetSubCondition = draft.cases
    ?.find(item => item.case_id === caseId)
    ?.conditions
    .find(item => item.id === conditionId)
    ?.sub_variable_condition
    ?.conditions
    .find(item => item.id === subConditionId)

  if (targetSubCondition)
    Object.assign(targetSubCondition, nextCondition)
})

export const toggleSubVariableConditionLogicalOperator = (
  inputs: IfElseNodeType,
  caseId: string,
  conditionId: string,
) => produce(inputs, (draft) => {
  const targetSubVariableCondition = draft.cases
    ?.find(item => item.case_id === caseId)
    ?.conditions
    .find(item => item.id === conditionId)
    ?.sub_variable_condition

  if (!targetSubVariableCondition)
    return

  targetSubVariableCondition.logical_operator = targetSubVariableCondition.logical_operator === LogicalOperator.and
    ? LogicalOperator.or
    : LogicalOperator.and
})
