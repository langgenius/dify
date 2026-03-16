import type {
  BatchTestRecord,
  ComparisonOperator,
  EvaluationFieldOption,
  EvaluationMetric,
  EvaluationResourceState,
  EvaluationResourceType,
  JudgmentConditionGroup,
} from './types'
import { create } from 'zustand'
import { getComparisonOperators, getDefaultOperator, getEvaluationMockConfig } from './mock'

type EvaluationStore = {
  resources: Record<string, EvaluationResourceState>
  ensureResource: (resourceType: EvaluationResourceType, resourceId: string) => void
  setJudgeModel: (resourceType: EvaluationResourceType, resourceId: string, judgeModelId: string) => void
  addBuiltinMetric: (resourceType: EvaluationResourceType, resourceId: string, optionId: string) => void
  addCustomMetric: (resourceType: EvaluationResourceType, resourceId: string) => void
  removeMetric: (resourceType: EvaluationResourceType, resourceId: string, metricId: string) => void
  setCustomMetricWorkflow: (resourceType: EvaluationResourceType, resourceId: string, metricId: string, workflowId: string) => void
  addCustomMetricMapping: (resourceType: EvaluationResourceType, resourceId: string, metricId: string) => void
  updateCustomMetricMapping: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    metricId: string,
    mappingId: string,
    patch: { sourceFieldId?: string | null, targetVariableId?: string | null },
  ) => void
  removeCustomMetricMapping: (resourceType: EvaluationResourceType, resourceId: string, metricId: string, mappingId: string) => void
  addConditionGroup: (resourceType: EvaluationResourceType, resourceId: string) => void
  removeConditionGroup: (resourceType: EvaluationResourceType, resourceId: string, groupId: string) => void
  setConditionGroupOperator: (resourceType: EvaluationResourceType, resourceId: string, groupId: string, logicalOperator: 'and' | 'or') => void
  addConditionItem: (resourceType: EvaluationResourceType, resourceId: string, groupId: string) => void
  removeConditionItem: (resourceType: EvaluationResourceType, resourceId: string, groupId: string, itemId: string) => void
  updateConditionField: (resourceType: EvaluationResourceType, resourceId: string, groupId: string, itemId: string, fieldId: string) => void
  updateConditionOperator: (resourceType: EvaluationResourceType, resourceId: string, groupId: string, itemId: string, operator: ComparisonOperator) => void
  updateConditionValue: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    groupId: string,
    itemId: string,
    value: string | number | boolean | null,
  ) => void
  setBatchTab: (resourceType: EvaluationResourceType, resourceId: string, tab: EvaluationResourceState['activeBatchTab']) => void
  setUploadedFileName: (resourceType: EvaluationResourceType, resourceId: string, uploadedFileName: string | null) => void
  runBatchTest: (resourceType: EvaluationResourceType, resourceId: string) => void
}

const buildResourceKey = (resourceType: EvaluationResourceType, resourceId: string) => `${resourceType}:${resourceId}`
const initialResourceCache: Record<string, EvaluationResourceState> = {}

const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

export const conditionOperatorsWithoutValue: ComparisonOperator[] = ['is_empty', 'is_not_empty']

export const requiresConditionValue = (operator: ComparisonOperator) => !conditionOperatorsWithoutValue.includes(operator)

const getConditionValue = (
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

const buildConditionItem = (resourceType: EvaluationResourceType) => {
  const field = getEvaluationMockConfig(resourceType).fieldOptions[0]
  const operator = field ? getDefaultOperator(field.type) : 'contains'

  return {
    id: createId('condition'),
    fieldId: field?.id ?? null,
    operator,
    value: getConditionValue(field, operator),
  }
}

const buildInitialState = (resourceType: EvaluationResourceType): EvaluationResourceState => {
  const config = getEvaluationMockConfig(resourceType)
  const defaultMetric = config.builtinMetrics[0]

  return {
    judgeModelId: null,
    metrics: defaultMetric
      ? [{
          id: createId('metric'),
          optionId: defaultMetric.id,
          kind: 'builtin',
          label: defaultMetric.label,
          description: defaultMetric.description,
          badges: defaultMetric.badges,
        }]
      : [],
    conditions: [{
      id: createId('group'),
      logicalOperator: 'and',
      items: [buildConditionItem(resourceType)],
    }],
    activeBatchTab: 'input-fields',
    uploadedFileName: null,
    batchRecords: [],
  }
}

const withResourceState = (
  resources: EvaluationStore['resources'],
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  const resourceKey = buildResourceKey(resourceType, resourceId)

  return {
    resourceKey,
    resource: resources[resourceKey] ?? buildInitialState(resourceType),
  }
}

const updateMetric = (
  metrics: EvaluationMetric[],
  metricId: string,
  updater: (metric: EvaluationMetric) => EvaluationMetric,
) => metrics.map(metric => metric.id === metricId ? updater(metric) : metric)

const updateConditionGroup = (
  groups: JudgmentConditionGroup[],
  groupId: string,
  updater: (group: JudgmentConditionGroup) => JudgmentConditionGroup,
) => groups.map(group => group.id === groupId ? updater(group) : group)

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

export const useEvaluationStore = create<EvaluationStore>((set, get) => ({
  resources: {},
  ensureResource: (resourceType, resourceId) => {
    const resourceKey = buildResourceKey(resourceType, resourceId)
    if (get().resources[resourceKey])
      return

    set(state => ({
      resources: {
        ...state.resources,
        [resourceKey]: buildInitialState(resourceType),
      },
    }))
  },
  setJudgeModel: (resourceType, resourceId, judgeModelId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            judgeModelId,
          },
        },
      }
    })
  },
  addBuiltinMetric: (resourceType, resourceId, optionId) => {
    const option = getEvaluationMockConfig(resourceType).builtinMetrics.find(metric => metric.id === optionId)
    if (!option)
      return

    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      if (resource.metrics.some(metric => metric.optionId === optionId && metric.kind === 'builtin'))
        return state

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: [
              ...resource.metrics,
              {
                id: createId('metric'),
                optionId: option.id,
                kind: 'builtin',
                label: option.label,
                description: option.description,
                badges: option.badges,
              },
            ],
          },
        },
      }
    })
  },
  addCustomMetric: (resourceType, resourceId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: [
              ...resource.metrics,
              {
                id: createId('metric'),
                optionId: createId('custom'),
                kind: 'custom-workflow',
                label: 'Custom Evaluator',
                description: 'Map workflow variables to your evaluation inputs.',
                badges: ['Workflow'],
                customConfig: {
                  workflowId: null,
                  mappings: [{
                    id: createId('mapping'),
                    sourceFieldId: null,
                    targetVariableId: null,
                  }],
                },
              },
            ],
          },
        },
      }
    })
  },
  removeMetric: (resourceType, resourceId, metricId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: resource.metrics.filter(metric => metric.id !== metricId),
          },
        },
      }
    })
  },
  setCustomMetricWorkflow: (resourceType, resourceId, metricId, workflowId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: updateMetric(resource.metrics, metricId, metric => ({
              ...metric,
              customConfig: metric.customConfig
                ? {
                    ...metric.customConfig,
                    workflowId,
                    mappings: metric.customConfig.mappings.map(mapping => ({
                      ...mapping,
                      targetVariableId: null,
                    })),
                  }
                : metric.customConfig,
            })),
          },
        },
      }
    })
  },
  addCustomMetricMapping: (resourceType, resourceId, metricId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: updateMetric(resource.metrics, metricId, metric => ({
              ...metric,
              customConfig: metric.customConfig
                ? {
                    ...metric.customConfig,
                    mappings: [
                      ...metric.customConfig.mappings,
                      {
                        id: createId('mapping'),
                        sourceFieldId: null,
                        targetVariableId: null,
                      },
                    ],
                  }
                : metric.customConfig,
            })),
          },
        },
      }
    })
  },
  updateCustomMetricMapping: (resourceType, resourceId, metricId, mappingId, patch) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: updateMetric(resource.metrics, metricId, metric => ({
              ...metric,
              customConfig: metric.customConfig
                ? {
                    ...metric.customConfig,
                    mappings: metric.customConfig.mappings.map(mapping => mapping.id === mappingId ? { ...mapping, ...patch } : mapping),
                  }
                : metric.customConfig,
            })),
          },
        },
      }
    })
  },
  removeCustomMetricMapping: (resourceType, resourceId, metricId, mappingId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            metrics: updateMetric(resource.metrics, metricId, metric => ({
              ...metric,
              customConfig: metric.customConfig
                ? {
                    ...metric.customConfig,
                    mappings: metric.customConfig.mappings.filter(mapping => mapping.id !== mappingId),
                  }
                : metric.customConfig,
            })),
          },
        },
      }
    })
  },
  addConditionGroup: (resourceType, resourceId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: [
              ...resource.conditions,
              {
                id: createId('group'),
                logicalOperator: 'and',
                items: [buildConditionItem(resourceType)],
              },
            ],
          },
        },
      }
    })
  },
  removeConditionGroup: (resourceType, resourceId, groupId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: resource.conditions.filter(group => group.id !== groupId),
          },
        },
      }
    })
  },
  setConditionGroupOperator: (resourceType, resourceId, groupId, logicalOperator) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: updateConditionGroup(resource.conditions, groupId, group => ({
              ...group,
              logicalOperator,
            })),
          },
        },
      }
    })
  },
  addConditionItem: (resourceType, resourceId, groupId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: updateConditionGroup(resource.conditions, groupId, group => ({
              ...group,
              items: [
                ...group.items,
                buildConditionItem(resourceType),
              ],
            })),
          },
        },
      }
    })
  },
  removeConditionItem: (resourceType, resourceId, groupId, itemId) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: updateConditionGroup(resource.conditions, groupId, group => ({
              ...group,
              items: group.items.filter(item => item.id !== itemId),
            })),
          },
        },
      }
    })
  },
  updateConditionField: (resourceType, resourceId, groupId, itemId, fieldId) => {
    const field = getEvaluationMockConfig(resourceType).fieldOptions.find(option => option.id === fieldId)

    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: updateConditionGroup(resource.conditions, groupId, group => ({
              ...group,
              items: group.items.map((item) => {
                if (item.id !== itemId)
                  return item

                return {
                  ...item,
                  fieldId,
                  operator: field ? getDefaultOperator(field.type) : item.operator,
                  value: getConditionValue(field, field ? getDefaultOperator(field.type) : item.operator),
                }
              }),
            })),
          },
        },
      }
    })
  },
  updateConditionOperator: (resourceType, resourceId, groupId, itemId, operator) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)
      const fieldOptions = getEvaluationMockConfig(resourceType).fieldOptions

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: updateConditionGroup(resource.conditions, groupId, group => ({
              ...group,
              items: group.items.map((item) => {
                if (item.id !== itemId)
                  return item

                const field = fieldOptions.find(option => option.id === item.fieldId)

                return {
                  ...item,
                  operator,
                  value: getConditionValue(field, operator, item.value),
                }
              }),
            })),
          },
        },
      }
    })
  },
  updateConditionValue: (resourceType, resourceId, groupId, itemId, value) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            conditions: updateConditionGroup(resource.conditions, groupId, group => ({
              ...group,
              items: group.items.map(item => item.id === itemId ? { ...item, value } : item),
            })),
          },
        },
      }
    })
  },
  setBatchTab: (resourceType, resourceId, tab) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            activeBatchTab: tab,
          },
        },
      }
    })
  },
  setUploadedFileName: (resourceType, resourceId, uploadedFileName) => {
    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            uploadedFileName,
          },
        },
      }
    })
  },
  runBatchTest: (resourceType, resourceId) => {
    const config = getEvaluationMockConfig(resourceType)
    const recordId = createId('batch')
    const nextRecord: BatchTestRecord = {
      id: recordId,
      fileName: get().resources[buildResourceKey(resourceType, resourceId)]?.uploadedFileName ?? config.templateFileName,
      status: 'running',
      startedAt: new Date().toLocaleTimeString(),
      summary: config.historySummaryLabel,
    }

    set((state) => {
      const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

      return {
        resources: {
          ...state.resources,
          [resourceKey]: {
            ...resource,
            activeBatchTab: 'history',
            batchRecords: [nextRecord, ...resource.batchRecords],
          },
        },
      }
    })

    window.setTimeout(() => {
      set((state) => {
        const { resource, resourceKey } = withResourceState(state.resources, resourceType, resourceId)

        return {
          resources: {
            ...state.resources,
            [resourceKey]: {
              ...resource,
              batchRecords: resource.batchRecords.map(record => record.id === recordId
                ? {
                    ...record,
                    status: resource.metrics.length > 1 ? 'success' : 'failed',
                  }
                : record),
            },
          },
        }
      })
    }, 1200)
  },
}))

export const useEvaluationResource = (resourceType: EvaluationResourceType, resourceId: string) => {
  const resourceKey = buildResourceKey(resourceType, resourceId)
  return useEvaluationStore(state => state.resources[resourceKey] ?? (initialResourceCache[resourceKey] ??= buildInitialState(resourceType)))
}

export const getAllowedOperators = (resourceType: EvaluationResourceType, fieldId: string | null) => {
  const field = getEvaluationMockConfig(resourceType).fieldOptions.find(option => option.id === fieldId)

  if (!field)
    return ['contains'] as ComparisonOperator[]

  return getComparisonOperators(field.type)
}
