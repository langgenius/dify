import { ComparisonOperator } from './types'
import { VarType } from '@/app/components/workflow/types'
import type { Branch } from '@/app/components/workflow/types'

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

export const comparisonOperatorNotRequireValue = (operator?: ComparisonOperator) => {
  if (!operator)
    return false

  return [ComparisonOperator.empty, ComparisonOperator.notEmpty, ComparisonOperator.isNull, ComparisonOperator.isNotNull].includes(operator)
}

export const branchNameCorrect = (branches: Branch[]) => {
  const branchLength = branches.length
  if (branchLength < 2)
    throw new Error('if-else node branch number must than 2')

  if (branchLength === 2) {
    return branches.map((branch) => {
      return {
        ...branch,
        name: branch.id === 'false' ? 'ELSE' : 'IF',
      }
    })
  }

  return branches.map((branch, index) => {
    return {
      ...branch,
      name: branch.id === 'false' ? 'ELSE' : `CASE ${index + 1}`,
    }
  })
}
