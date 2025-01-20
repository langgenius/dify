import type { VarType as NumberVarType } from '../tool/types'
import type {
  BlockEnum,
  CommonNodeType,
  ErrorHandleMode,
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
  logical_operator: LogicalOperator
  conditions: Condition[]
}

export type HandleAddCondition = (valueSelector: ValueSelector, varItem: Var) => void
export type HandleRemoveCondition = (conditionId: string) => void
export type HandleUpdateCondition = (conditionId: string, newCondition: Condition) => void
export type HandleUpdateConditionLogicalOperator = (value: LogicalOperator) => void

export type HandleToggleConditionLogicalOperator = () => void

export type HandleAddSubVariableCondition = (conditionId: string, key?: string) => void
export type handleRemoveSubVariableCondition = (conditionId: string, subConditionId: string) => void
export type HandleUpdateSubVariableCondition = (conditionId: string, subConditionId: string, newSubCondition: Condition) => void
export type HandleToggleSubVariableConditionLogicalOperator = (conditionId: string) => void

export type LoopNodeType = CommonNodeType & {
  startNodeType?: BlockEnum
  start_node_id: string
  loop_id?: string
  logical_operator?: LogicalOperator
  break_conditions?: Condition[]
  loop_count: number
  error_handle_mode: ErrorHandleMode // how to handle error in the iteration
}
