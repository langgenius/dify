import type {
  BatchTestRecord,
  ComparisonOperator,
  CustomMetricMapping,
  EvaluationFieldOption,
  EvaluationMetric,
  EvaluationResourceState,
  EvaluationResourceType,
  JudgmentConditionGroup,
  MetricOption,
} from './types'
import { getComparisonOperators, getDefaultOperator, getEvaluationMockConfig } from './mock'

export type EvaluationStoreResources = Record<string, EvaluationResourceState>

const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

export const buildResourceKey = (resourceType: EvaluationResourceType, resourceId: string) => `${resourceType}:${resourceId}`

export const conditionOperatorsWithoutValue: ComparisonOperator[] = ['is_empty', 'is_not_empty']

export const requiresConditionValue = (operator: ComparisonOperator) => !conditionOperatorsWithoutValue.includes(operator)

export const getConditionValue = (
  field: EvaluationFieldOption | undefined,
  operator: ComparisonOperator,
  previousValue: string | number | boolean | null = null,
) => {
  if (!field || !requiresConditionValue(operator))
    return null

  if (field.type === 'boolean')
    return typeof previousValue === 'boolean' ? previousValue : null

  if (field.type === 'enum')
    return typeof previousValue === 'string' ? previousValue : null

  if (field.type === 'number')
    return typeof previousValue === 'number' ? previousValue : null

  return typeof previousValue === 'string' ? previousValue : null
}

export const createBuiltinMetric = (metric: MetricOption): EvaluationMetric => ({
  id: createId('metric'),
  optionId: metric.id,
  kind: 'builtin',
  label: metric.label,
  description: metric.description,
  badges: metric.badges,
})

export const createCustomMetricMapping = (): CustomMetricMapping => ({
  id: createId('mapping'),
  sourceFieldId: null,
  targetVariableId: null,
})

export const createCustomMetric = (): EvaluationMetric => ({
  id: createId('metric'),
  optionId: createId('custom'),
  kind: 'custom-workflow',
  label: 'Custom Evaluator',
  description: 'Map workflow variables to your evaluation inputs.',
  badges: ['Workflow'],
  customConfig: {
    workflowId: null,
    mappings: [createCustomMetricMapping()],
  },
})

export const buildConditionItem = (resourceType: EvaluationResourceType) => {
  const field = getEvaluationMockConfig(resourceType).fieldOptions[0]
  const operator = field ? getDefaultOperator(field.type) : 'contains'

  return {
    id: createId('condition'),
    fieldId: field?.id ?? null,
    operator,
    value: getConditionValue(field, operator),
  }
}

export const createConditionGroup = (resourceType: EvaluationResourceType): JudgmentConditionGroup => ({
  id: createId('group'),
  logicalOperator: 'and',
  items: [buildConditionItem(resourceType)],
})

export const buildInitialState = (resourceType: EvaluationResourceType): EvaluationResourceState => {
  const config = getEvaluationMockConfig(resourceType)
  const defaultMetric = config.builtinMetrics[0]

  return {
    judgeModelId: null,
    metrics: defaultMetric ? [createBuiltinMetric(defaultMetric)] : [],
    conditions: [createConditionGroup(resourceType)],
    activeBatchTab: 'input-fields',
    uploadedFileName: null,
    batchRecords: [],
  }
}

export const getResourceState = (
  resources: EvaluationStoreResources,
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  const resourceKey = buildResourceKey(resourceType, resourceId)

  return {
    resourceKey,
    resource: resources[resourceKey] ?? buildInitialState(resourceType),
  }
}

export const updateResourceState = (
  resources: EvaluationStoreResources,
  resourceType: EvaluationResourceType,
  resourceId: string,
  updater: (resource: EvaluationResourceState) => EvaluationResourceState,
) => {
  const { resource, resourceKey } = getResourceState(resources, resourceType, resourceId)

  return {
    ...resources,
    [resourceKey]: updater(resource),
  }
}

export const updateMetric = (
  metrics: EvaluationMetric[],
  metricId: string,
  updater: (metric: EvaluationMetric) => EvaluationMetric,
) => metrics.map(metric => metric.id === metricId ? updater(metric) : metric)

export const updateConditionGroup = (
  groups: JudgmentConditionGroup[],
  groupId: string,
  updater: (group: JudgmentConditionGroup) => JudgmentConditionGroup,
) => groups.map(group => group.id === groupId ? updater(group) : group)

export const createBatchTestRecord = (
  resourceType: EvaluationResourceType,
  uploadedFileName: string | null | undefined,
): BatchTestRecord => {
  const config = getEvaluationMockConfig(resourceType)

  return {
    id: createId('batch'),
    fileName: uploadedFileName ?? config.templateFileName,
    status: 'running',
    startedAt: new Date().toLocaleTimeString(),
    summary: config.historySummaryLabel,
  }
}

export const isCustomMetricConfigured = (metric: EvaluationMetric) => {
  if (metric.kind !== 'custom-workflow')
    return true

  if (!metric.customConfig?.workflowId)
    return false

  return metric.customConfig.mappings.length > 0
    && metric.customConfig.mappings.every(mapping => !!mapping.sourceFieldId && !!mapping.targetVariableId)
}

export const isEvaluationRunnable = (state: EvaluationResourceState) => {
  return !!state.judgeModelId
    && state.metrics.length > 0
    && state.metrics.every(isCustomMetricConfigured)
    && state.conditions.some(group => group.items.length > 0)
}

export const getAllowedOperators = (resourceType: EvaluationResourceType, fieldId: string | null) => {
  const field = getEvaluationMockConfig(resourceType).fieldOptions.find(option => option.id === fieldId)

  if (!field)
    return ['contains'] as ComparisonOperator[]

  return getComparisonOperators(field.type)
}
