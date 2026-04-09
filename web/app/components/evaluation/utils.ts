import type { TFunction } from 'i18next'
import type { ComparisonOperator, EvaluationFieldOption } from './types'

export const TAB_CLASS_NAME = 'flex-1 rounded-lg px-3 py-2 text-left system-sm-medium'

const compactOperatorLabels: Partial<Record<ComparisonOperator, string>> = {
  is: '=',
  is_not: '!=',
  greater_than: '>',
  less_than: '<',
  greater_or_equal: '>=',
  less_or_equal: '<=',
}

export const encodeModelSelection = (provider: string, model: string) => `${provider}::${model}`

export const decodeModelSelection = (judgeModelId: string | null) => {
  if (!judgeModelId)
    return undefined

  const [provider, model] = judgeModelId.split('::')
  if (!provider || !model)
    return undefined

  return { provider, model }
}

export const groupFieldOptions = (fieldOptions: EvaluationFieldOption[]) => {
  return Object.entries(fieldOptions.reduce<Record<string, EvaluationFieldOption[]>>((acc, field) => {
    acc[field.group] = [...(acc[field.group] ?? []), field]
    return acc
  }, {}))
}

export const getOperatorLabel = (
  operator: ComparisonOperator,
  fieldType: EvaluationFieldOption['type'] | undefined,
  t: TFunction<'evaluation'>,
) => {
  if (fieldType === 'number' && compactOperatorLabels[operator])
    return compactOperatorLabels[operator] as string

  return t(`conditions.operators.${operator}` as const)
}

export const getFieldTypeIconClassName = (fieldType: EvaluationFieldOption['type']) => {
  if (fieldType === 'number')
    return 'i-ri-hashtag'

  if (fieldType === 'boolean')
    return 'i-ri-checkbox-circle-line'

  if (fieldType === 'enum')
    return 'i-ri-list-check-2'

  return 'i-ri-text'
}
