import { VarType } from '@/app/components/workflow/types'

const COMPARISON_OPERATOR_WITHOUT_VALUE = new Set([
  'empty',
  'not empty',
  'null',
  'not null',
  'exists',
  'not exists',
])

export const getConditionOperators = (varType?: VarType): string[] => {
  switch (varType) {
    case VarType.number:
      return ['=', '≠', '>', '<', '≥', '≤']
    case VarType.boolean:
      return ['is', 'is not']
    case VarType.arrayString:
    case VarType.arrayNumber:
    case VarType.arrayBoolean:
    case VarType.array:
    case VarType.arrayAny:
      return ['contains', 'not contains', 'empty', 'not empty']
    case VarType.arrayFile:
      return ['contains', 'not contains', 'empty', 'not empty']
    case VarType.file:
      return ['exists', 'not exists']
    case VarType.object:
      return ['empty', 'not empty']
    case VarType.any:
      return ['is', 'is not', 'empty', 'not empty']
    default:
      return ['contains', 'not contains', 'start with', 'end with', 'is', 'is not', 'empty', 'not empty']
  }
}

export const operatorNeedsValue = (operator?: string): boolean => {
  if (!operator)
    return false

  return !COMPARISON_OPERATOR_WITHOUT_VALUE.has(operator)
}

export const getDefaultValueByType = (varType: VarType): string | boolean => {
  if (varType === VarType.boolean)
    return true

  return ''
}
