import type { VarType as NumberVarType } from '../tool/types'
import type { CommonNodeType, ValueSelector, Var, VarType } from '@/app/components/workflow/types'

export const LogicalOperator = {
  and: 'and',
  or: 'or',
} as const

export type LogicalOperator = (typeof LogicalOperator)[keyof typeof LogicalOperator]

export const ComparisonOperator = {
  contains: 'contains',
  notContains: 'not contains',
  startWith: 'start with',
  endWith: 'end with',
  is: 'is',
  isNot: 'is not',
  empty: 'empty',
  notEmpty: 'not empty',
  equal: '=',
  notEqual: '≠',
  largerThan: '>',
  lessThan: '<',
  largerThanOrEqual: '≥',
  lessThanOrEqual: '≤',
  isNull: 'is null',
  isNotNull: 'is not null',
  in: 'in',
  notIn: 'not in',
  allOf: 'all of',
  exists: 'exists',
  notExists: 'not exists',
} as const

export type ComparisonOperator = (typeof ComparisonOperator)[keyof typeof ComparisonOperator]

export type Condition = {
  id: string
  varType: VarType
  variable_selector?: ValueSelector
  key?: string // sub variable key
  comparison_operator?: ComparisonOperator
  value: string | string[] | boolean
  numberVarType?: NumberVarType
  sub_variable_condition?: CaseItem
}

export type CaseItem = {
  case_id: string
  logical_operator: LogicalOperator
  conditions: Condition[]
}

export type IfElseNodeType = CommonNodeType & {
  logical_operator?: LogicalOperator
  conditions?: Condition[]
  cases: CaseItem[]
  isInIteration: boolean
  isInLoop: boolean
}

export type HandleAddCondition = (
  caseId: string,
  valueSelector: ValueSelector,
  varItem: Var,
) => void
export type HandleRemoveCondition = (caseId: string, conditionId: string) => void
export type HandleUpdateCondition = (
  caseId: string,
  conditionId: string,
  newCondition: Condition,
) => void
export type HandleToggleConditionLogicalOperator = (caseId: string) => void

export type HandleAddSubVariableCondition = (
  caseId: string,
  conditionId: string,
  key?: string,
) => void
export type handleRemoveSubVariableCondition = (
  caseId: string,
  conditionId: string,
  subConditionId: string,
) => void
export type HandleUpdateSubVariableCondition = (
  caseId: string,
  conditionId: string,
  subConditionId: string,
  newSubCondition: Condition,
) => void
export type HandleToggleSubVariableConditionLogicalOperator = (
  caseId: string,
  conditionId: string,
) => void
