import { ComparisonOperator } from './types'
import { VarType } from '@/app/components/workflow/types'

export const isEmptyRelatedOperator = (operator: ComparisonOperator) => {
  return [ComparisonOperator.empty, ComparisonOperator.notEmpty, ComparisonOperator.isNull, ComparisonOperator.isNotNull].includes(operator)
}

const notTranslateKey = [
  ComparisonOperator.equal, ComparisonOperator.notEqual,
  ComparisonOperator.largerThan, ComparisonOperator.largerThanOrEqual,
  ComparisonOperator.lessThan, ComparisonOperator.lessThanOrEqual,
]

export const isComparisonOperatorNeedTranslate = (operator?: ComparisonOperator) => {
  if (!operator)
    return false
  return !notTranslateKey.includes(operator)
}

export const getOperators = (type?: VarType) => {
  switch (type) {
    case VarType.string:
      return [
        ComparisonOperator.contains,
        ComparisonOperator.notContains,
        ComparisonOperator.startWith,
        ComparisonOperator.endWith,
        ComparisonOperator.is,
        ComparisonOperator.isNot,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
    case VarType.number:
      return [
        ComparisonOperator.equal,
        ComparisonOperator.notEqual,
        ComparisonOperator.largerThan,
        ComparisonOperator.lessThan,
        ComparisonOperator.largerThanOrEqual,
        ComparisonOperator.lessThanOrEqual,
        ComparisonOperator.is,
        ComparisonOperator.isNot,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
    case VarType.arrayString:
    case VarType.arrayNumber:
      return [
        ComparisonOperator.contains,
        ComparisonOperator.notContains,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
    case VarType.array:
    case VarType.arrayObject:
      return [
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
    default:
      return [
        ComparisonOperator.is,
        ComparisonOperator.isNot,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
  }
}
