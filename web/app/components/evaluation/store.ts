import type {
  ComparisonOperator,
  EvaluationResourceState,
  EvaluationResourceType,
} from './types'
import type { EvaluationConfig, NodeInfo } from '@/types/evaluation'
import { create } from 'zustand'
import { getDefaultOperator, getEvaluationMockConfig } from './mock'
import {
  buildConditionItem,
  buildInitialState,
  buildResourceKey,
  buildStateFromEvaluationConfig,
  createBatchTestRecord,
  createBuiltinMetric,
  createConditionGroup,
  createCustomMetric,
  getAllowedOperators as getAllowedOperatorsFromUtils,
  getConditionValue,
  isCustomMetricConfigured as isCustomMetricConfiguredFromUtils,
  isEvaluationRunnable as isEvaluationRunnableFromUtils,
  requiresConditionValue as requiresConditionValueFromUtils,
  syncCustomMetricMappings as syncCustomMetricMappingsFromUtils,
  updateConditionGroup,
  updateMetric,
  updateResourceState,
} from './store-utils'

type EvaluationStore = {
  resources: Record<string, EvaluationResourceState>
  ensureResource: (resourceType: EvaluationResourceType, resourceId: string) => void
  hydrateResource: (resourceType: EvaluationResourceType, resourceId: string, config: EvaluationConfig) => void
  setJudgeModel: (resourceType: EvaluationResourceType, resourceId: string, judgeModelId: string) => void
  addBuiltinMetric: (resourceType: EvaluationResourceType, resourceId: string, optionId: string, nodeInfoList?: NodeInfo[]) => void
  updateMetricThreshold: (resourceType: EvaluationResourceType, resourceId: string, metricId: string, threshold: number) => void
  addCustomMetric: (resourceType: EvaluationResourceType, resourceId: string) => void
  removeMetric: (resourceType: EvaluationResourceType, resourceId: string, metricId: string) => void
  setCustomMetricWorkflow: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    metricId: string,
    workflow: { workflowId: string, workflowAppId: string, workflowName: string },
  ) => void
  syncCustomMetricMappings: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    metricId: string,
    inputVariableIds: string[],
  ) => void
  updateCustomMetricMapping: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    metricId: string,
    mappingId: string,
    patch: { inputVariableId?: string | null, outputVariableId?: string | null },
  ) => void
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

const initialResourceCache: Record<string, EvaluationResourceState> = {}

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
  hydrateResource: (resourceType, resourceId, config) => {
    set(state => ({
      resources: {
        ...state.resources,
        [buildResourceKey(resourceType, resourceId)]: {
          ...buildStateFromEvaluationConfig(resourceType, config),
          activeBatchTab: state.resources[buildResourceKey(resourceType, resourceId)]?.activeBatchTab ?? 'input-fields',
          uploadedFileName: state.resources[buildResourceKey(resourceType, resourceId)]?.uploadedFileName ?? null,
          batchRecords: state.resources[buildResourceKey(resourceType, resourceId)]?.batchRecords ?? [],
        },
      },
    }))
  },
  setJudgeModel: (resourceType, resourceId, judgeModelId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        judgeModelId,
      })),
    }))
  },
  addBuiltinMetric: (resourceType, resourceId, optionId, nodeInfoList = []) => {
    const option = getEvaluationMockConfig(resourceType).builtinMetrics.find(metric => metric.id === optionId)
    if (!option)
      return

    set((state) => {
      return {
        resources: updateResourceState(state.resources, resourceType, resourceId, currentResource => ({
          ...currentResource,
          metrics: currentResource.metrics.some(metric => metric.optionId === optionId && metric.kind === 'builtin')
            ? currentResource.metrics.map(metric => metric.optionId === optionId && metric.kind === 'builtin'
                ? {
                    ...metric,
                    nodeInfoList,
                  }
                : metric)
            : [...currentResource.metrics, createBuiltinMetric(option, nodeInfoList)],
        })),
      }
    })
  },
  updateMetricThreshold: (resourceType, resourceId, metricId, threshold) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        metrics: updateMetric(resource.metrics, metricId, metric => ({
          ...metric,
          threshold,
        })),
      })),
    }))
  },
  addCustomMetric: (resourceType, resourceId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        metrics: resource.metrics.some(metric => metric.kind === 'custom-workflow')
          ? resource.metrics
          : [...resource.metrics, createCustomMetric()],
      })),
    }))
  },
  removeMetric: (resourceType, resourceId, metricId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        metrics: resource.metrics.filter(metric => metric.id !== metricId),
      })),
    }))
  },
  setCustomMetricWorkflow: (resourceType, resourceId, metricId, workflow) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        metrics: updateMetric(resource.metrics, metricId, metric => ({
          ...metric,
          customConfig: metric.customConfig
            ? {
                ...metric.customConfig,
                workflowId: workflow.workflowId,
                workflowAppId: workflow.workflowAppId,
                workflowName: workflow.workflowName,
                mappings: metric.customConfig.mappings.map(mapping => ({
                  ...mapping,
                  outputVariableId: null,
                })),
              }
            : metric.customConfig,
        })),
      })),
    }))
  },
  syncCustomMetricMappings: (resourceType, resourceId, metricId, inputVariableIds) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        metrics: updateMetric(resource.metrics, metricId, metric => ({
          ...metric,
          customConfig: metric.customConfig
            ? {
                ...metric.customConfig,
                mappings: syncCustomMetricMappingsFromUtils(metric.customConfig.mappings, inputVariableIds),
              }
            : metric.customConfig,
        })),
      })),
    }))
  },
  updateCustomMetricMapping: (resourceType, resourceId, metricId, mappingId, patch) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
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
      })),
    }))
  },
  addConditionGroup: (resourceType, resourceId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: [...resource.conditions, createConditionGroup(resourceType)],
      })),
    }))
  },
  removeConditionGroup: (resourceType, resourceId, groupId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: resource.conditions.filter(group => group.id !== groupId),
      })),
    }))
  },
  setConditionGroupOperator: (resourceType, resourceId, groupId, logicalOperator) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: updateConditionGroup(resource.conditions, groupId, group => ({
          ...group,
          logicalOperator,
        })),
      })),
    }))
  },
  addConditionItem: (resourceType, resourceId, groupId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: updateConditionGroup(resource.conditions, groupId, group => ({
          ...group,
          items: [...group.items, buildConditionItem(resourceType)],
        })),
      })),
    }))
  },
  removeConditionItem: (resourceType, resourceId, groupId, itemId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: updateConditionGroup(resource.conditions, groupId, group => ({
          ...group,
          items: group.items.filter(item => item.id !== itemId),
        })),
      })),
    }))
  },
  updateConditionField: (resourceType, resourceId, groupId, itemId, fieldId) => {
    const field = getEvaluationMockConfig(resourceType).fieldOptions.find(option => option.id === fieldId)

    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: updateConditionGroup(resource.conditions, groupId, group => ({
          ...group,
          items: group.items.map((item) => {
            if (item.id !== itemId)
              return item

            const nextOperator = field ? getDefaultOperator(field.type) : item.operator

            return {
              ...item,
              fieldId,
              operator: nextOperator,
              value: getConditionValue(field, nextOperator),
            }
          }),
        })),
      })),
    }))
  },
  updateConditionOperator: (resourceType, resourceId, groupId, itemId, operator) => {
    set((state) => {
      const fieldOptions = getEvaluationMockConfig(resourceType).fieldOptions

      return {
        resources: updateResourceState(state.resources, resourceType, resourceId, currentResource => ({
          ...currentResource,
          conditions: updateConditionGroup(currentResource.conditions, groupId, group => ({
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
        })),
      }
    })
  },
  updateConditionValue: (resourceType, resourceId, groupId, itemId, value) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        conditions: updateConditionGroup(resource.conditions, groupId, group => ({
          ...group,
          items: group.items.map(item => item.id === itemId ? { ...item, value } : item),
        })),
      })),
    }))
  },
  setBatchTab: (resourceType, resourceId, tab) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        activeBatchTab: tab,
      })),
    }))
  },
  setUploadedFileName: (resourceType, resourceId, uploadedFileName) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        uploadedFileName,
      })),
    }))
  },
  runBatchTest: (resourceType, resourceId) => {
    const { uploadedFileName } = get().resources[buildResourceKey(resourceType, resourceId)] ?? buildInitialState(resourceType)
    const nextRecord = createBatchTestRecord(resourceType, uploadedFileName)

    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        activeBatchTab: 'history',
        batchRecords: [nextRecord, ...resource.batchRecords],
      })),
    }))

    window.setTimeout(() => {
      set(state => ({
        resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
          ...resource,
          batchRecords: resource.batchRecords.map(record => record.id === nextRecord.id
            ? {
                ...record,
                status: resource.metrics.length > 1 ? 'success' : 'failed',
              }
            : record),
        })),
      }))
    }, 1200)
  },
}))

export const useEvaluationResource = (resourceType: EvaluationResourceType, resourceId: string) => {
  const resourceKey = buildResourceKey(resourceType, resourceId)
  return useEvaluationStore(state => state.resources[resourceKey] ?? (initialResourceCache[resourceKey] ??= buildInitialState(resourceType)))
}

export const getAllowedOperators = (resourceType: EvaluationResourceType, fieldId: string | null) => {
  return getAllowedOperatorsFromUtils(resourceType, fieldId)
}

export const isCustomMetricConfigured = (metric: EvaluationResourceState['metrics'][number]) => {
  return isCustomMetricConfiguredFromUtils(metric)
}

export const isEvaluationRunnable = (state: EvaluationResourceState) => {
  return isEvaluationRunnableFromUtils(state)
}

export const requiresConditionValue = (operator: ComparisonOperator) => {
  return requiresConditionValueFromUtils(operator)
}
