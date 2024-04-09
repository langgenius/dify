import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

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
  variable_selector: ValueSelector
  comparison_operator?: ComparisonOperator
  value: string
}

export type IfElseNodeType = CommonNodeType & {
  logical_operator: LogicalOperator
  conditions: Condition[]
}
