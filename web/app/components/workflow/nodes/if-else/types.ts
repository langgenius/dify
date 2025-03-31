import type { VarType as NumberVarType } from '../tool/types'
import type {
  CommonNodeType,
  ValueSelector,
  Var,
  VarType,
} from '@/app/components/workflow/types'

export enum LogicalOperator {
  and = 'and',
  or = 'or',
}

export enum ComparisonOperator {
  contains = 'contains',
  notContains = 'not contains',
  startWith = 'start with',
  endWith = 'end with',
  is = 'is',
  isNot = 'is not',
  empty = 'empty',
  notEmpty = 'not empty',
  equal = '=',
  notEqual = '≠',
  largerThan = '>',
  lessThan = '<',
  largerThanOrEqual = '≥',
  lessThanOrEqual = '≤',
  isNull = 'is null',
  isNotNull = 'is not null',
  in = 'in',
  notIn = 'not in',
  allOf = 'all of',
  exists = 'exists',
  notExists = 'not exists',
}

export type Condition = {
  id: string
  varType: VarType
  variable_selector?: ValueSelector
  key?: string // sub variable key
  comparison_operator?: ComparisonOperator
  value: string | string[]
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

export type HandleAddCondition = (caseId: string, valueSelector: ValueSelector, varItem: Var) => void
export type HandleRemoveCondition = (caseId: string, conditionId: string) => void
export type HandleUpdateCondition = (caseId: string, conditionId: string, newCondition: Condition) => void
export type HandleToggleConditionLogicalOperator = (caseId: string) => void

export type HandleAddSubVariableCondition = (caseId: string, conditionId: string, key?: string) => void
export type handleRemoveSubVariableCondition = (caseId: string, conditionId: string, subConditionId: string) => void
export type HandleUpdateSubVariableCondition = (caseId: string, conditionId: string, subConditionId: string, newSubCondition: Condition) => void
export type HandleToggleSubVariableConditionLogicalOperator = (caseId: string, conditionId: string) => void
