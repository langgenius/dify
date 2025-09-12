import {
  ComparisonOperator,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'

export const isEmptyRelatedOperator = (operator: ComparisonOperator) => {
  return [ComparisonOperator.empty, ComparisonOperator.notEmpty, ComparisonOperator.isNull, ComparisonOperator.isNotNull, ComparisonOperator.exists, ComparisonOperator.notExists].includes(operator)
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

export const getOperators = (type?: MetadataFilteringVariableType) => {
  switch (type) {
    case MetadataFilteringVariableType.string:
    case MetadataFilteringVariableType.select:
      return [
        ComparisonOperator.is,
        ComparisonOperator.isNot,
        ComparisonOperator.contains,
        ComparisonOperator.notContains,
        ComparisonOperator.startWith,
        ComparisonOperator.endWith,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
        ComparisonOperator.in,
        ComparisonOperator.notIn,
      ]
    case MetadataFilteringVariableType.number:
      return [
        ComparisonOperator.equal,
        ComparisonOperator.notEqual,
        ComparisonOperator.largerThan,
        ComparisonOperator.lessThan,
        ComparisonOperator.largerThanOrEqual,
        ComparisonOperator.lessThanOrEqual,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
    default:
      return [
        ComparisonOperator.is,
        ComparisonOperator.before,
        ComparisonOperator.after,
        ComparisonOperator.empty,
        ComparisonOperator.notEmpty,
      ]
  }
}

export const comparisonOperatorNotRequireValue = (operator?: ComparisonOperator) => {
  if (!operator)
    return false

  return [ComparisonOperator.empty, ComparisonOperator.notEmpty, ComparisonOperator.isNull, ComparisonOperator.isNotNull, ComparisonOperator.exists, ComparisonOperator.notExists].includes(operator)
}

export const VARIABLE_REGEX = /\{\{(#[a-zA-Z0-9_-]{1,50}(\.[a-zA-Z_]\w{0,29}){1,10}#)\}\}/gi
export const COMMON_VARIABLE_REGEX = /\{\{([a-zA-Z0-9_-]{1,50})\}\}/gi
