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
import type {
  EvaluationConditionValue,
  EvaluationConfig,
  EvaluationCustomizedMetric,
  EvaluationDefaultMetric,
  EvaluationJudgementConditionGroup,
  EvaluationJudgementConditionItem,
  EvaluationMetricsConfig,
  NodeInfo,
} from '@/types/evaluation'
import { getComparisonOperators, getDefaultOperator, getEvaluationMockConfig } from './mock'
import { encodeModelSelection } from './utils'

type EvaluationStoreResources = Record<string, EvaluationResourceState>

const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

const humanizeMetricId = (metricId: string) => {
  return metricId
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const resolveMetricOption = (resourceType: EvaluationResourceType, metricId: string): MetricOption => {
  const config = getEvaluationMockConfig(resourceType)
  return config.builtinMetrics.find(metric => metric.id === metricId) ?? {
    id: metricId,
    label: humanizeMetricId(metricId),
    description: '',
    group: config.builtinMetrics[0]?.group ?? 'other',
    badges: ['Built-in'],
  }
}

const normalizeNodeInfoList = (value: NodeInfo[] | undefined): NodeInfo[] => {
  if (!value?.length)
    return []

  return value
    .map((item) => {
      const nodeId = typeof item.node_id === 'string' ? item.node_id : ''
      const title = typeof item.title === 'string' ? item.title : nodeId
      const type = typeof item.type === 'string' ? item.type : ''

      if (!nodeId)
        return null

      return {
        node_id: nodeId,
        title,
        type,
      }
    })
    .filter((item): item is NodeInfo => !!item)
}

const normalizeDefaultMetrics = (
  resourceType: EvaluationResourceType,
  value: EvaluationDefaultMetric[] | undefined,
): EvaluationMetric[] => {
  if (!value?.length)
    return []

  return value
    .map((item) => {
      const metricId = typeof item.metric === 'string' ? item.metric : ''
      if (!metricId)
        return null

      const metricOption = resolveMetricOption(resourceType, metricId)
      return createBuiltinMetric(metricOption, normalizeNodeInfoList(item.node_info_list ?? []))
    })
    .filter((item): item is EvaluationMetric => !!item)
}

const normalizeCustomMetricMappings = (
  value: EvaluationCustomizedMetric['input_fields'],
): CustomMetricMapping[] => {
  if (!value)
    return [createCustomMetricMapping()]

  const mappings = Object.entries(value)
    .filter((entry): entry is [string, string] => {
      const [, targetVariableId] = entry
      return typeof targetVariableId === 'string' && !!targetVariableId
    })
    .map(([sourceFieldId, targetVariableId]) => ({
      id: createId('mapping'),
      sourceFieldId,
      targetVariableId,
    }))

  return mappings.length > 0 ? mappings : [createCustomMetricMapping()]
}

const normalizeCustomMetric = (
  value: EvaluationCustomizedMetric | null | undefined,
): EvaluationMetric[] => {
  if (!value)
    return []

  const workflowId = typeof value.evaluation_workflow_id === 'string' ? value.evaluation_workflow_id : null
  if (!workflowId)
    return []

  const customMetric = createCustomMetric()

  return [{
    ...customMetric,
    customConfig: customMetric.customConfig
      ? {
          ...customMetric.customConfig,
          workflowId,
          mappings: normalizeCustomMetricMappings(value.input_fields),
        }
      : customMetric.customConfig,
  }]
}

const normalizeConditionItem = (
  resourceType: EvaluationResourceType,
  value: EvaluationJudgementConditionItem,
): JudgmentConditionGroup['items'][number] => {
  const fieldId = typeof value.fieldId === 'string'
    ? value.fieldId
    : typeof value.field_id === 'string'
      ? value.field_id
      : null
  const operatorValue = typeof value.operator === 'string' ? value.operator : null
  const field = getEvaluationMockConfig(resourceType).fieldOptions.find(option => option.id === fieldId)
  const allowedOperators = field ? getComparisonOperators(field.type) : ['contains']
  const operator = operatorValue && allowedOperators.includes(operatorValue as ComparisonOperator)
    ? operatorValue as ComparisonOperator
    : field
      ? getDefaultOperator(field.type)
      : 'contains'
  const rawValue: EvaluationConditionValue = value.value ?? null

  return {
    id: typeof value.id === 'string' ? value.id : createId('condition'),
    fieldId,
    operator,
    value: getConditionValue(field, operator, rawValue),
  }
}

const normalizeConditionGroups = (
  resourceType: EvaluationResourceType,
  value: EvaluationConfig['judgement_conditions'],
): JudgmentConditionGroup[] => {
  const groupsValue: EvaluationJudgementConditionGroup[] = Array.isArray(value)
    ? value
    : Array.isArray(value?.groups)
      ? value.groups
      : []

  const groups = groupsValue
    .map((group) => {
      const itemsValue = Array.isArray(group.items) ? group.items : []
      const items = itemsValue
        .map(item => normalizeConditionItem(resourceType, item))

      if (items.length === 0)
        return null

      return {
        id: typeof group.id === 'string' ? group.id : createId('group'),
        logicalOperator: group.logicalOperator === 'or' || group.logical_operator === 'or' ? 'or' : 'and',
        items,
      } satisfies JudgmentConditionGroup
    })
    .filter((group): group is JudgmentConditionGroup => !!group)

  return groups.length > 0 ? groups : [createConditionGroup(resourceType)]
}

export const buildResourceKey = (resourceType: EvaluationResourceType, resourceId: string) => `${resourceType}:${resourceId}`

const conditionOperatorsWithoutValue: ComparisonOperator[] = ['is_empty', 'is_not_empty']

export const requiresConditionValue = (operator: ComparisonOperator) => !conditionOperatorsWithoutValue.includes(operator)

export function getConditionValue(
  field: EvaluationFieldOption | undefined,
  operator: ComparisonOperator,
  previousValue: string | number | boolean | null = null,
) {
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

export function createBuiltinMetric(metric: MetricOption, nodeInfoList: NodeInfo[] = []): EvaluationMetric {
  return {
    id: createId('metric'),
    optionId: metric.id,
    kind: 'builtin',
    label: metric.label,
    description: metric.description,
    badges: metric.badges,
    nodeInfoList,
  }
}

export function createCustomMetricMapping(): CustomMetricMapping {
  return {
    id: createId('mapping'),
    sourceFieldId: null,
    targetVariableId: null,
  }
}

export function createCustomMetric(): EvaluationMetric {
  return {
    id: createId('metric'),
    optionId: createId('custom'),
    kind: 'custom-workflow',
    label: 'Custom Evaluator',
    description: 'Map workflow variables to your evaluation inputs.',
    badges: ['Workflow'],
    customConfig: {
      workflowId: null,
      workflowAppId: null,
      workflowName: null,
      mappings: [createCustomMetricMapping()],
    },
  }
}

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

export function createConditionGroup(resourceType: EvaluationResourceType): JudgmentConditionGroup {
  return {
    id: createId('group'),
    logicalOperator: 'and',
    items: [buildConditionItem(resourceType)],
  }
}

export const buildInitialState = (resourceType: EvaluationResourceType): EvaluationResourceState => {
  return {
    judgeModelId: null,
    metrics: [],
    conditions: [createConditionGroup(resourceType)],
    activeBatchTab: 'input-fields',
    uploadedFileName: null,
    batchRecords: [],
  }
}

export const buildStateFromEvaluationConfig = (
  resourceType: EvaluationResourceType,
  config: EvaluationConfig,
): EvaluationResourceState => {
  const metricsConfig: EvaluationMetricsConfig = config.metrics_config ?? {}
  const defaultMetrics = normalizeDefaultMetrics(resourceType, metricsConfig.default_metrics)
  const customMetrics = normalizeCustomMetric(metricsConfig.customized_metrics)

  return {
    ...buildInitialState(resourceType),
    judgeModelId: config.evaluation_model && config.evaluation_model_provider
      ? encodeModelSelection(config.evaluation_model_provider, config.evaluation_model)
      : null,
    metrics: [...defaultMetrics, ...customMetrics],
    conditions: normalizeConditionGroups(resourceType, config.judgement_conditions),
  }
}

const getResourceState = (
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
