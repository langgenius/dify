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
}

export type Condition = {
  id: string
  varType: VarType
  variable_selector: ValueSelector
  comparison_operator?: ComparisonOperator
  value: string
  numberVarType?: NumberVarType
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
}

export type HandleAddCondition = (caseId: string, valueSelector: ValueSelector, varItem: Var) => void
export type HandleRemoveCondition = (caseId: string, conditionId: string) => void
export type HandleUpdateCondition = (caseId: string, conditionId: string, newCondition: Condition) => void
export type HandleUpdateConditionLogicalOperator = (caseId: string, value: LogicalOperator) => void
