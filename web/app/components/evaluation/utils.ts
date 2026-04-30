import type { TFunction } from 'i18next'
import type {
  ComparisonOperator,
  ConditionMetricOption,
  ConditionMetricOptionGroup,
  ConditionMetricValueType,
  EvaluationMetric,
} from './types'

export const TAB_CLASS_NAME = 'flex-1 rounded-lg px-3 py-2 text-left system-sm-medium'

const rawOperatorLabels = new Set<ComparisonOperator>(['=', '≠', '>', '<', '≥', '≤'])

const noValueOperators = new Set<ComparisonOperator>(['empty', 'not empty', 'is null', 'is not null'])

export const encodeModelSelection = (provider: string, model: string) => `${provider}::${model}`

export const decodeModelSelection = (judgeModelId: string | null) => {
  if (!judgeModelId)
    return undefined

  const [provider, model] = judgeModelId.split('::')
  if (!provider || !model)
    return undefined

  return { provider, model }
}

export const getComparisonOperatorLabel = (
  operator: ComparisonOperator,
  t: TFunction,
) => {
  if (rawOperatorLabels.has(operator))
    return operator

  return t(`nodes.ifElse.comparisonOperator.${operator}` as never, { ns: 'workflow' } as never) as unknown as string
}

export const requiresComparisonValue = (operator: ComparisonOperator) => {
  return !noValueOperators.has(operator)
}

const getMetricValueType = (valueType: string | null | undefined): ConditionMetricValueType => {
  if (valueType === 'number' || valueType === 'integer')
    return 'number'

  if (valueType === 'boolean')
    return 'boolean'

  return 'string'
}

export const getComparisonOperators = (valueType: ConditionMetricValueType): ComparisonOperator[] => {
  if (valueType === 'number')
    return ['=', '≠', '>', '<', '≥', '≤', 'is null', 'is not null']

  if (valueType === 'boolean')
    return ['is', 'is not', 'is null', 'is not null']

  return ['contains', 'not contains', 'start with', 'end with', 'is', 'is not', 'empty', 'not empty', 'in', 'not in', 'is null', 'is not null']
}

export const getDefaultComparisonOperator = (valueType: ConditionMetricValueType): ComparisonOperator => {
  return getComparisonOperators(valueType)[0]
}

export const buildConditionMetricOptions = (metrics: EvaluationMetric[]): ConditionMetricOption[] => {
  return metrics.flatMap((metric) => {
    if (metric.kind === 'builtin') {
      return (metric.nodeInfoList ?? []).map((nodeInfo) => {
        return {
          id: `${nodeInfo.node_id}:${metric.optionId}`,
          kind: metric.kind,
          groupLabel: metric.label,
          itemLabel: nodeInfo.title || nodeInfo.node_id,
          valueType: metric.valueType,
          variableSelector: [nodeInfo.node_id, metric.optionId] as [string, string],
          nodeInfo,
        }
      })
    }

    const customConfig = metric.customConfig

    if (!customConfig?.workflowId)
      return []

    return customConfig.outputs.map((output) => {
      return {
        id: `${customConfig.workflowId}:${output.id}`,
        kind: metric.kind,
        groupLabel: customConfig.workflowName ?? metric.label,
        itemLabel: output.id,
        valueType: getMetricValueType(output.valueType),
        variableSelector: [customConfig.workflowId, output.id] as [string, string],
      }
    })
  })
}

export const groupConditionMetricOptions = (metricOptions: ConditionMetricOption[]): ConditionMetricOptionGroup[] => {
  const groups = metricOptions.reduce<Map<string, ConditionMetricOption[]>>((acc, option) => {
    acc.set(option.groupLabel, [...(acc.get(option.groupLabel) ?? []), option])
    return acc
  }, new Map())

  return Array.from(groups.entries()).map(([label, options]) => ({
    label,
    options,
  }))
}

const conditionMetricValueTypeTranslationKeys = {
  string: 'conditions.valueTypes.string',
  number: 'conditions.valueTypes.number',
  boolean: 'conditions.valueTypes.boolean',
} as const

export const getConditionMetricValueTypeTranslationKey = (
  valueType: ConditionMetricValueType,
) => {
  return conditionMetricValueTypeTranslationKeys[valueType]
}

export const serializeVariableSelector = (value: [string, string] | null | undefined) => {
  return value ? JSON.stringify(value) : ''
}

export const isSelectorEqual = (
  left: [string, string] | null | undefined,
  right: [string, string] | null | undefined,
) => {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1]
}
