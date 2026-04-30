import type {
  BatchTestRecord,
  ComparisonOperator,
  CustomMetricMapping,
  EvaluationMetric,
  EvaluationResourceState,
  EvaluationResourceType,
  JudgmentConditionItem,
  JudgmentConfig,
  MetricOption,
} from './types'
import type {
  EvaluationConfig,
  EvaluationConfigData,
  EvaluationCustomizedMetric,
  EvaluationDefaultMetric,
  EvaluationJudgmentCondition,
  EvaluationJudgmentConditionValue,
  EvaluationJudgmentConfig,
  EvaluationRunRequest,
  NodeInfo,
} from '@/types/evaluation'
import { getDefaultMetricDescription } from './default-metric-descriptions'
import {
  buildConditionMetricOptions,
  decodeModelSelection,
  encodeModelSelection,
  getComparisonOperators,
  getDefaultComparisonOperator,
  requiresComparisonValue,
} from './utils'

type EvaluationStoreResources = Record<string, EvaluationResourceState>

export const DEFAULT_PIPELINE_METRIC_THRESHOLD = 0.85
export const EVALUATION_TEMPLATE_FILE_NAMES: Record<EvaluationResourceType, string> = {
  apps: 'workflow-evaluation-template.csv',
  snippets: 'snippet-evaluation-template.csv',
  datasets: 'pipeline-evaluation-template.csv',
}

const BATCH_HISTORY_SUMMARY_LABELS: Record<EvaluationResourceType, string> = {
  apps: 'Workflow evaluation batch',
  snippets: 'Snippet evaluation batch',
  datasets: 'Pipeline evaluation batch',
}

const PIPELINE_METRIC_IDS = new Set(['context-precision', 'context-recall', 'context-relevance'])

const PIPELINE_LOGICAL_OPERATOR: JudgmentConfig['logicalOperator'] = 'and'

const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

const humanizeMetricId = (metricId: string) => {
  return metricId
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const resolveMetricOption = (metricId: string): MetricOption => {
  return {
    id: metricId,
    label: humanizeMetricId(metricId),
    description: getDefaultMetricDescription(metricId),
    valueType: 'number',
  }
}

const isPipelineResourceType = (resourceType: EvaluationResourceType) => resourceType === 'datasets'

const isPipelineResourceState = (resource: EvaluationResourceState) => {
  return resource.metrics.length > 0
    && resource.metrics.every(metric => metric.kind === 'builtin' && PIPELINE_METRIC_IDS.has(metric.optionId))
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

const normalizeDefaultMetrics = (value: EvaluationDefaultMetric[] | null | undefined): EvaluationMetric[] => {
  if (!value?.length)
    return []

  return value
    .map((item) => {
      const metricId = typeof item.metric === 'string' ? item.metric : ''
      if (!metricId)
        return null

      const metricOption = resolveMetricOption(metricId)
      return createBuiltinMetric(metricOption, normalizeNodeInfoList(item.node_info_list ?? []))
    })
    .filter((item): item is EvaluationMetric => !!item)
}

const normalizeCustomMetricMappings = (
  value: EvaluationCustomizedMetric['input_fields'],
): CustomMetricMapping[] => {
  if (!value)
    return []

  return Object.entries(value)
    .filter((entry): entry is [string, string] => {
      const [, outputVariableId] = entry
      return typeof outputVariableId === 'string' && !!outputVariableId
    })
    .map(([inputVariableId, outputVariableId]) => createCustomMetricMapping(inputVariableId, outputVariableId))
}

const normalizeCustomMetricOutputs = (
  value: EvaluationCustomizedMetric['output_fields'],
) => {
  if (!value)
    return []

  return value
    .map((output) => {
      const id = typeof output.variable === 'string' ? output.variable : ''
      if (!id)
        return null

      return {
        id,
        valueType: typeof output.value_type === 'string' ? output.value_type : null,
      }
    })
    .filter((output): output is { id: string, valueType: string | null } => !!output)
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
          outputs: normalizeCustomMetricOutputs(value.output_fields),
        }
      : customMetric.customConfig,
  }]
}

const normalizeVariableSelector = (value: string[] | undefined): [string, string] | null => {
  if (!Array.isArray(value) || value.length < 2)
    return null

  const [scope, metricName] = value
  return typeof scope === 'string' && !!scope && typeof metricName === 'string' && !!metricName
    ? [scope, metricName]
    : null
}

const getConditionNumericValue = (value: EvaluationJudgmentCondition['value']) => {
  if (typeof value === 'number')
    return value

  if (typeof value !== 'string')
    return null

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

const getPipelineMetricThreshold = (
  metric: EvaluationMetric,
  config: EvaluationConfig,
) => {
  const matchingCondition = (config.judgment_config?.conditions ?? []).find((condition) => {
    const variableSelector = normalizeVariableSelector(condition.variable_selector)
    if (!variableSelector || variableSelector[1] !== metric.optionId || condition.comparison_operator !== '≥')
      return false

    if (!metric.nodeInfoList?.length)
      return true

    return metric.nodeInfoList.some(nodeInfo => nodeInfo.node_id === variableSelector[0])
  })

  return getConditionNumericValue(matchingCondition?.value) ?? metric.threshold ?? DEFAULT_PIPELINE_METRIC_THRESHOLD
}

const normalizePipelineMetrics = (
  config: EvaluationConfig,
  metrics: EvaluationMetric[],
) => {
  return metrics.map(metric => ({
    ...metric,
    valueType: 'number' as const,
    threshold: getPipelineMetricThreshold(metric, config),
  }))
}

const getNormalizedConditionValue = (
  operator: ComparisonOperator,
  previousValue: EvaluationJudgmentConditionValue | string | number | boolean | null | undefined,
) => {
  if (!requiresComparisonValue(operator))
    return null

  if (Array.isArray(previousValue))
    return previousValue.filter((item): item is string => typeof item === 'string' && !!item)

  if (typeof previousValue === 'boolean')
    return previousValue

  if (typeof previousValue === 'number')
    return String(previousValue)

  return typeof previousValue === 'string' ? previousValue : null
}

const normalizeConditionItem = (
  value: EvaluationJudgmentCondition,
  metrics: EvaluationMetric[],
): JudgmentConditionItem | null => {
  const variableSelector = normalizeVariableSelector(value.variable_selector)
  if (!variableSelector)
    return null

  const metricOption = buildConditionMetricOptions(metrics).find(option =>
    option.variableSelector[0] === variableSelector[0] && option.variableSelector[1] === variableSelector[1],
  )
  if (!metricOption)
    return null

  const allowedOperators = getComparisonOperators(metricOption.valueType)
  const rawOperator = typeof value.comparison_operator === 'string' ? value.comparison_operator : ''
  const comparisonOperator = allowedOperators.includes(rawOperator as ComparisonOperator)
    ? rawOperator as ComparisonOperator
    : getDefaultComparisonOperator(metricOption.valueType)

  return {
    id: createId('condition'),
    variableSelector,
    comparisonOperator,
    value: getConditionValue(metricOption.valueType, comparisonOperator, value.value),
  }
}

const createEmptyJudgmentConfig = (): JudgmentConfig => {
  return {
    logicalOperator: 'and',
    conditions: [],
  }
}

const normalizeJudgmentConfig = (
  config: EvaluationConfig,
  metrics: EvaluationMetric[],
): JudgmentConfig => {
  const rawJudgmentConfig: EvaluationJudgmentConfig | null | undefined = config.judgment_config

  if (!rawJudgmentConfig)
    return createEmptyJudgmentConfig()

  const conditions = (rawJudgmentConfig.conditions ?? [])
    .map(condition => normalizeConditionItem(condition, metrics))
    .filter((condition): condition is JudgmentConditionItem => !!condition)

  return {
    logicalOperator: rawJudgmentConfig.logical_operator === 'or' ? 'or' : 'and',
    conditions,
  }
}

export const buildResourceKey = (resourceType: EvaluationResourceType, resourceId: string) => `${resourceType}:${resourceId}`

export const requiresConditionValue = (operator: ComparisonOperator) => {
  return requiresComparisonValue(operator)
}

export function getConditionValue(
  valueType: EvaluationMetric['valueType'] | undefined,
  operator: ComparisonOperator,
  previousValue?: EvaluationJudgmentConditionValue | string | number | boolean | null,
) {
  if (!valueType || !requiresConditionValue(operator))
    return null

  if (valueType === 'boolean')
    return typeof previousValue === 'boolean' ? previousValue : null

  if (operator === 'in' || operator === 'not in') {
    if (Array.isArray(previousValue))
      return previousValue.filter((item): item is string => typeof item === 'string' && !!item)

    return typeof previousValue === 'string' && previousValue
      ? previousValue.split(',').map(item => item.trim()).filter(Boolean)
      : []
  }

  return getNormalizedConditionValue(operator, previousValue)
}

export function createBuiltinMetric(
  metric: MetricOption,
  nodeInfoList: NodeInfo[] = [],
  threshold = DEFAULT_PIPELINE_METRIC_THRESHOLD,
): EvaluationMetric {
  return {
    id: createId('metric'),
    optionId: metric.id,
    kind: 'builtin',
    label: metric.label,
    description: metric.description,
    valueType: metric.valueType,
    threshold,
    nodeInfoList,
  }
}

function createCustomMetricMapping(
  inputVariableId: string | null = null,
  outputVariableId: string | null = null,
): CustomMetricMapping {
  return {
    id: createId('mapping'),
    inputVariableId,
    outputVariableId,
  }
}

export const syncCustomMetricMappings = (
  mappings: CustomMetricMapping[],
  inputVariableIds: string[],
) => {
  const mappingByInputVariableId = new Map(
    mappings
      .filter(mapping => !!mapping.inputVariableId)
      .map(mapping => [mapping.inputVariableId, mapping]),
  )

  return inputVariableIds.map((inputVariableId) => {
    const existingMapping = mappingByInputVariableId.get(inputVariableId)
    return existingMapping
      ? {
          ...existingMapping,
          inputVariableId,
        }
      : createCustomMetricMapping(inputVariableId, null)
  })
}

export function createCustomMetric(): EvaluationMetric {
  return {
    id: createId('metric'),
    optionId: createId('custom'),
    kind: 'custom-workflow',
    label: 'Custom Evaluator',
    description: 'Map workflow variables to your evaluation inputs.',
    valueType: 'number',
    customConfig: {
      workflowId: null,
      workflowAppId: null,
      workflowName: null,
      mappings: [],
      outputs: [],
    },
  }
}

export const buildConditionItem = (
  metrics: EvaluationMetric[],
  variableSelector?: [string, string] | null,
): JudgmentConditionItem => {
  const metricOptions = buildConditionMetricOptions(metrics)
  const metricOption = variableSelector
    ? metricOptions.find(option =>
      option.variableSelector[0] === variableSelector[0]
      && option.variableSelector[1] === variableSelector[1],
    ) ?? metricOptions[0]
    : metricOptions[0]
  const comparisonOperator = metricOption ? getDefaultComparisonOperator(metricOption.valueType) : 'is'

  return {
    id: createId('condition'),
    variableSelector: metricOption?.variableSelector ?? null,
    comparisonOperator,
    value: getConditionValue(metricOption?.valueType, comparisonOperator),
  }
}

export const syncJudgmentConfigWithMetrics = (
  judgmentConfig: JudgmentConfig,
  metrics: EvaluationMetric[],
): JudgmentConfig => {
  const metricOptions = buildConditionMetricOptions(metrics)

  return {
    logicalOperator: judgmentConfig.logicalOperator,
    conditions: judgmentConfig.conditions
      .map((condition) => {
        const metricOption = metricOptions.find(option =>
          option.variableSelector[0] === condition.variableSelector?.[0]
          && option.variableSelector[1] === condition.variableSelector?.[1],
        )
        if (!metricOption)
          return null

        const allowedOperators = getComparisonOperators(metricOption.valueType)
        const comparisonOperator = allowedOperators.includes(condition.comparisonOperator)
          ? condition.comparisonOperator
          : getDefaultComparisonOperator(metricOption.valueType)

        return {
          ...condition,
          comparisonOperator,
          value: getConditionValue(metricOption.valueType, comparisonOperator, condition.value),
        }
      })
      .filter((condition): condition is JudgmentConditionItem => !!condition),
  }
}

export const buildInitialState = (_resourceType: EvaluationResourceType): EvaluationResourceState => {
  return {
    judgeModelId: null,
    metrics: [],
    judgmentConfig: createEmptyJudgmentConfig(),
    activeBatchTab: 'input-fields',
    uploadedFileId: null,
    uploadedFileName: null,
    selectedRunId: null,
    batchRecords: [],
  }
}

export const buildStateFromEvaluationConfig = (
  resourceType: EvaluationResourceType,
  config: EvaluationConfig,
): EvaluationResourceState => {
  const defaultMetrics = normalizeDefaultMetrics(config.default_metrics)
  const customMetrics = isPipelineResourceType(resourceType) ? [] : normalizeCustomMetric(config.customized_metrics)
  const metrics = isPipelineResourceType(resourceType)
    ? normalizePipelineMetrics(config, defaultMetrics)
    : [...defaultMetrics, ...customMetrics]

  return {
    ...buildInitialState(resourceType),
    judgeModelId: config.evaluation_model && config.evaluation_model_provider
      ? encodeModelSelection(config.evaluation_model_provider, config.evaluation_model)
      : null,
    metrics,
    judgmentConfig: normalizeJudgmentConfig(config, metrics),
  }
}

const getApiComparisonOperator = (operator: ComparisonOperator) => {
  if (operator === 'is null')
    return 'null'

  if (operator === 'is not null')
    return 'not null'

  return operator
}

const getCustomMetricScopeId = (metric: EvaluationMetric) => {
  if (metric.kind !== 'custom-workflow')
    return null

  return metric.customConfig?.workflowAppId ?? metric.customConfig?.workflowId ?? null
}

const buildCustomizedMetricsPayload = (metrics: EvaluationMetric[]): EvaluationConfigData['customized_metrics'] => {
  const customMetric = metrics.find(metric => metric.kind === 'custom-workflow')
  const customConfig = customMetric?.customConfig
  const evaluationWorkflowId = customMetric ? getCustomMetricScopeId(customMetric) : null

  if (!customConfig || !evaluationWorkflowId)
    return null

  return {
    evaluation_workflow_id: evaluationWorkflowId,
    input_fields: Object.fromEntries(
      customConfig.mappings
        .filter((mapping): mapping is CustomMetricMapping & { inputVariableId: string, outputVariableId: string } =>
          !!mapping.inputVariableId && !!mapping.outputVariableId,
        )
        .map(mapping => [mapping.inputVariableId, mapping.outputVariableId]),
    ),
    output_fields: customConfig.outputs.map(output => ({
      variable: output.id,
      value_type: output.valueType ?? undefined,
    })),
  }
}

const buildPipelineJudgmentConfigPayload = (
  resource: EvaluationResourceState,
): EvaluationConfigData['judgment_config'] => {
  const conditions = resource.metrics
    .filter((metric): metric is EvaluationMetric & { kind: 'builtin' } => metric.kind === 'builtin')
    .map((metric) => {
      const nodeInfo = metric.nodeInfoList?.[0]
      if (!nodeInfo)
        return null

      return {
        variable_selector: [nodeInfo.node_id, metric.optionId],
        comparison_operator: '≥',
        value: String(metric.threshold ?? DEFAULT_PIPELINE_METRIC_THRESHOLD),
      }
    })
    .filter((condition): condition is NonNullable<typeof condition> => !!condition)

  if (!conditions.length)
    return null

  return {
    logical_operator: PIPELINE_LOGICAL_OPERATOR,
    conditions,
  }
}

const buildJudgmentConfigPayload = (
  resource: EvaluationResourceState,
  resourceType?: EvaluationResourceType,
): EvaluationConfigData['judgment_config'] => {
  if ((resourceType && isPipelineResourceType(resourceType)) || isPipelineResourceState(resource))
    return buildPipelineJudgmentConfigPayload(resource)

  const conditions = resource.judgmentConfig.conditions
    .filter(condition => !!condition.variableSelector)
    .map((condition) => {
      const [scope, metricName] = condition.variableSelector!
      const customMetric = resource.metrics.find(metric =>
        metric.kind === 'custom-workflow'
        && metric.customConfig?.workflowId === scope,
      )

      const customScopeId = customMetric ? getCustomMetricScopeId(customMetric) : null

      return {
        variable_selector: [customScopeId ?? scope, metricName],
        comparison_operator: getApiComparisonOperator(condition.comparisonOperator),
        ...(requiresComparisonValue(condition.comparisonOperator) ? { value: condition.value ?? undefined } : {}),
      }
    })

  if (!conditions.length)
    return null

  return {
    logical_operator: resource.judgmentConfig.logicalOperator,
    conditions,
  }
}

export const buildEvaluationConfigPayload = (
  resource: EvaluationResourceState,
  resourceType?: EvaluationResourceType,
): EvaluationConfigData | null => {
  const selectedModel = decodeModelSelection(resource.judgeModelId)

  if (!selectedModel)
    return null

  return {
    evaluation_model: selectedModel.model,
    evaluation_model_provider: selectedModel.provider,
    default_metrics: resource.metrics
      .filter(metric => metric.kind === 'builtin')
      .map(metric => ({
        metric: metric.optionId,
        value_type: metric.valueType,
        node_info_list: metric.nodeInfoList ?? [],
      })),
    customized_metrics: (resourceType && isPipelineResourceType(resourceType)) || isPipelineResourceState(resource)
      ? null
      : buildCustomizedMetricsPayload(resource.metrics),
    judgment_config: buildJudgmentConfigPayload(resource, resourceType),
  }
}

export const buildEvaluationRunRequest = (
  resource: EvaluationResourceState,
  fileId: string,
  resourceType?: EvaluationResourceType,
): EvaluationRunRequest | null => {
  const configPayload = buildEvaluationConfigPayload(resource, resourceType)

  if (!configPayload)
    return null

  return {
    ...configPayload,
    file_id: fileId,
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

export const createBatchTestRecord = (
  resourceType: EvaluationResourceType,
  uploadedFileName: string | null | undefined,
): BatchTestRecord => {
  return {
    id: createId('batch'),
    fileName: uploadedFileName ?? EVALUATION_TEMPLATE_FILE_NAMES[resourceType],
    status: 'running',
    startedAt: new Date().toLocaleTimeString(),
    summary: BATCH_HISTORY_SUMMARY_LABELS[resourceType],
  }
}

export const isCustomMetricConfigured = (metric: EvaluationMetric) => {
  if (metric.kind !== 'custom-workflow')
    return true

  if (!metric.customConfig?.workflowId)
    return false

  return metric.customConfig.mappings.length > 0
    && metric.customConfig.mappings.every(mapping => !!mapping.inputVariableId && !!mapping.outputVariableId)
}

export const isEvaluationRunnable = (state: EvaluationResourceState) => {
  return !!state.judgeModelId
    && state.metrics.length > 0
    && state.metrics.every(isCustomMetricConfigured)
}

export const getAllowedOperators = (
  metrics: EvaluationMetric[],
  variableSelector: [string, string] | null,
) => {
  const metricOption = buildConditionMetricOptions(metrics).find(option =>
    option.variableSelector[0] === variableSelector?.[0]
    && option.variableSelector[1] === variableSelector?.[1],
  )

  if (!metricOption)
    return ['is'] as ComparisonOperator[]

  return getComparisonOperators(metricOption.valueType)
}
