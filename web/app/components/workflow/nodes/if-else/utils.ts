import type { IfElseNodeType } from './types'
import { ComparisonOperator } from './types'

export const isEmptyRelatedOperator = (operator: ComparisonOperator) => {
  return [ComparisonOperator.empty, ComparisonOperator.notEmpty, ComparisonOperator.isNull, ComparisonOperator.isNotNull].includes(operator)
}

export const checkNodeValid = (payload: IfElseNodeType) => {
  return true
}

const notTranslateKey = [
  ComparisonOperator.equal, ComparisonOperator.notEqual,
  ComparisonOperator.largerThan, ComparisonOperator.largerThanOrEqual,
  ComparisonOperator.lessThan, ComparisonOperator.lessThanOrEqual,
]

export const isComparisonOperatorNeedTranslate = (operator: ComparisonOperator) => {
  return !notTranslateKey.includes(operator)
}
