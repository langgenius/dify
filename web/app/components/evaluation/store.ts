import type {
  ComparisonOperator,
  EvaluationResourceState,
  EvaluationResourceType,
  MetricOption,
} from './types'
import type { EvaluationConfig, NodeInfo } from '@/types/evaluation'
import { isEqual } from 'es-toolkit/predicate'
import { create } from 'zustand'
import {
  buildConditionItem,
  buildInitialState,
  buildResourceKey,
  buildStateFromEvaluationConfig,
  createBatchTestRecord,
  createBuiltinMetric,
  createCustomMetric,
  getAllowedOperators as getAllowedOperatorsFromUtils,
  getConditionValue,
  isCustomMetricConfigured as isCustomMetricConfiguredFromUtils,
  isEvaluationRunnable as isEvaluationRunnableFromUtils,
  requiresConditionValue as requiresConditionValueFromUtils,
  resolveMetricOption,
  syncCustomMetricMappings as syncCustomMetricMappingsFromUtils,
  syncJudgmentConfigWithMetrics,
  updateMetric,
  updateResourceState,
} from './store-utils'
import { buildConditionMetricOptions } from './utils'

type EvaluationStore = {
  resources: Record<string, EvaluationResourceState>
  initialResources: Record<string, EvaluationResourceState>
  ensureResource: (resourceType: EvaluationResourceType, resourceId: string) => void
  hydrateResource: (resourceType: EvaluationResourceType, resourceId: string, config: EvaluationConfig) => void
  resetResourceConfig: (resourceType: EvaluationResourceType, resourceId: string) => void
  markResourceConfigSaved: (resourceType: EvaluationResourceType, resourceId: string) => void
  setJudgeModel: (resourceType: EvaluationResourceType, resourceId: string, judgeModelId: string) => void
  addBuiltinMetric: (resourceType: EvaluationResourceType, resourceId: string, optionId: string, nodeInfoList?: NodeInfo[], metricOption?: MetricOption) => void
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
  syncCustomMetricOutputs: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    metricId: string,
    outputs: Array<{ id: string, valueType: string | null }>,
  ) => void
  updateCustomMetricMapping: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    metricId: string,
    mappingId: string,
    patch: { inputVariableId?: string | null, outputVariableId?: string | null },
  ) => void
  setConditionLogicalOperator: (resourceType: EvaluationResourceType, resourceId: string, logicalOperator: 'and' | 'or') => void
  addCondition: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    variableSelector?: [string, string] | null,
  ) => void
  removeCondition: (resourceType: EvaluationResourceType, resourceId: string, conditionId: string) => void
  updateConditionMetric: (resourceType: EvaluationResourceType, resourceId: string, conditionId: string, variableSelector: [string, string]) => void
  updateConditionOperator: (resourceType: EvaluationResourceType, resourceId: string, conditionId: string, operator: ComparisonOperator) => void
  updateConditionValue: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    conditionId: string,
    value: string | string[] | boolean | null,
  ) => void
  setBatchTab: (resourceType: EvaluationResourceType, resourceId: string, tab: EvaluationResourceState['activeBatchTab']) => void
  setUploadedFile: (
    resourceType: EvaluationResourceType,
    resourceId: string,
    uploadedFile: { id: string, name: string } | null,
  ) => void
  setUploadedFileName: (resourceType: EvaluationResourceType, resourceId: string, uploadedFileName: string | null) => void
  setSelectedRunId: (resourceType: EvaluationResourceType, resourceId: string, runId: string | null) => void
  runBatchTest: (resourceType: EvaluationResourceType, resourceId: string) => void
}

const initialResourceCache: Record<string, EvaluationResourceState> = {}

const cloneEvaluationResourceState = (resource: EvaluationResourceState): EvaluationResourceState => ({
  ...resource,
  metrics: resource.metrics.map(metric => ({
    ...metric,
    nodeInfoList: metric.nodeInfoList?.map(nodeInfo => ({ ...nodeInfo })),
    customConfig: metric.customConfig
      ? {
          ...metric.customConfig,
          mappings: metric.customConfig.mappings.map(mapping => ({ ...mapping })),
          outputs: metric.customConfig.outputs.map(output => ({ ...output })),
        }
      : undefined,
  })),
  judgmentConfig: {
    ...resource.judgmentConfig,
    conditions: resource.judgmentConfig.conditions.map(condition => ({ ...condition })),
  },
  batchRecords: resource.batchRecords.map(record => ({ ...record })),
})

const preserveBatchState = (
  configState: EvaluationResourceState,
  currentResource: EvaluationResourceState | undefined,
  resourceType: EvaluationResourceType,
): EvaluationResourceState => {
  const initialState = buildInitialState(resourceType)

  return {
    ...cloneEvaluationResourceState(configState),
    activeBatchTab: currentResource?.activeBatchTab ?? initialState.activeBatchTab,
    uploadedFileId: currentResource?.uploadedFileId ?? initialState.uploadedFileId,
    uploadedFileName: currentResource?.uploadedFileName ?? initialState.uploadedFileName,
    selectedRunId: currentResource?.selectedRunId ?? initialState.selectedRunId,
    batchRecords: currentResource?.batchRecords.map(record => ({ ...record })) ?? initialState.batchRecords,
  }
}

const createConfigSnapshot = (
  resourceType: EvaluationResourceType,
  resource: EvaluationResourceState,
): EvaluationResourceState => {
  const initialState = buildInitialState(resourceType)

  return {
    ...cloneEvaluationResourceState(resource),
    activeBatchTab: initialState.activeBatchTab,
    uploadedFileId: initialState.uploadedFileId,
    uploadedFileName: initialState.uploadedFileName,
    selectedRunId: initialState.selectedRunId,
    batchRecords: initialState.batchRecords,
  }
}

const pickConfigComparableState = (resource: EvaluationResourceState) => ({
  judgeModelId: resource.judgeModelId,
  metrics: resource.metrics,
  judgmentConfig: resource.judgmentConfig,
})

export const useEvaluationStore = create<EvaluationStore>((set, get) => ({
  resources: {},
  initialResources: {},
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
    const resourceKey = buildResourceKey(resourceType, resourceId)
    const configState = buildStateFromEvaluationConfig(resourceType, config)

    set(state => ({
      resources: {
        ...state.resources,
        [resourceKey]: preserveBatchState(configState, state.resources[resourceKey], resourceType),
      },
      initialResources: {
        ...state.initialResources,
        [resourceKey]: createConfigSnapshot(resourceType, configState),
      },
    }))
  },
  resetResourceConfig: (resourceType, resourceId) => {
    const resourceKey = buildResourceKey(resourceType, resourceId)

    set(state => ({
      resources: {
        ...state.resources,
        [resourceKey]: preserveBatchState(
          state.initialResources[resourceKey] ?? buildInitialState(resourceType),
          state.resources[resourceKey],
          resourceType,
        ),
      },
    }))
  },
  markResourceConfigSaved: (resourceType, resourceId) => {
    const resourceKey = buildResourceKey(resourceType, resourceId)
    const resource = get().resources[resourceKey] ?? buildInitialState(resourceType)

    set(state => ({
      initialResources: {
        ...state.initialResources,
        [resourceKey]: createConfigSnapshot(resourceType, resource),
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
  addBuiltinMetric: (resourceType, resourceId, optionId, nodeInfoList = [], metricOption) => {
    const option = metricOption ?? resolveMetricOption(optionId)
    set((state) => {
      return {
        resources: updateResourceState(state.resources, resourceType, resourceId, (currentResource) => {
          const metrics = currentResource.metrics.some(metric => metric.optionId === optionId && metric.kind === 'builtin')
            ? currentResource.metrics.map(metric => metric.optionId === optionId && metric.kind === 'builtin'
                ? {
                    ...metric,
                    nodeInfoList,
                  }
                : metric)
            : [...currentResource.metrics, createBuiltinMetric(option, nodeInfoList)]

          return {
            ...currentResource,
            metrics,
            judgmentConfig: syncJudgmentConfigWithMetrics(currentResource.judgmentConfig, metrics),
          }
        }),
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
      resources: updateResourceState(state.resources, resourceType, resourceId, (resource) => {
        const metrics = resource.metrics.some(metric => metric.kind === 'custom-workflow')
          ? resource.metrics
          : [...resource.metrics, createCustomMetric()]

        return {
          ...resource,
          metrics,
          judgmentConfig: syncJudgmentConfigWithMetrics(resource.judgmentConfig, metrics),
        }
      }),
    }))
  },
  removeMetric: (resourceType, resourceId, metricId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, (resource) => {
        const metrics = resource.metrics.filter(metric => metric.id !== metricId)

        return {
          ...resource,
          metrics,
          judgmentConfig: syncJudgmentConfigWithMetrics(resource.judgmentConfig, metrics),
        }
      }),
    }))
  },
  setCustomMetricWorkflow: (resourceType, resourceId, metricId, workflow) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, (resource) => {
        const metrics = updateMetric(resource.metrics, metricId, metric => ({
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
                outputs: [],
              }
            : metric.customConfig,
        }))

        return {
          ...resource,
          metrics,
          judgmentConfig: syncJudgmentConfigWithMetrics(resource.judgmentConfig, metrics),
        }
      }),
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
  syncCustomMetricOutputs: (resourceType, resourceId, metricId, outputs) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, (resource) => {
        const metrics = updateMetric(resource.metrics, metricId, metric => ({
          ...metric,
          customConfig: metric.customConfig
            ? {
                ...metric.customConfig,
                outputs,
              }
            : metric.customConfig,
        }))

        return {
          ...resource,
          metrics,
          judgmentConfig: syncJudgmentConfigWithMetrics(resource.judgmentConfig, metrics),
        }
      }),
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
  setConditionLogicalOperator: (resourceType, resourceId, logicalOperator) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        judgmentConfig: {
          ...resource.judgmentConfig,
          logicalOperator,
        },
      })),
    }))
  },
  addCondition: (resourceType, resourceId, variableSelector) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        judgmentConfig: {
          ...resource.judgmentConfig,
          conditions: [...resource.judgmentConfig.conditions, buildConditionItem(resource.metrics, variableSelector)],
        },
      })),
    }))
  },
  removeCondition: (resourceType, resourceId, conditionId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        judgmentConfig: {
          ...resource.judgmentConfig,
          conditions: resource.judgmentConfig.conditions.filter(condition => condition.id !== conditionId),
        },
      })),
    }))
  },
  updateConditionMetric: (resourceType, resourceId, conditionId, variableSelector) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, (resource) => {
        const allowedOperators = getAllowedOperatorsFromUtils(resource.metrics, variableSelector)
        const comparisonOperator = allowedOperators[0]
        const metricOption = buildConditionMetricOptions(resource.metrics).find(option =>
          option.variableSelector[0] === variableSelector[0] && option.variableSelector[1] === variableSelector[1],
        )

        return {
          ...resource,
          judgmentConfig: {
            ...resource.judgmentConfig,
            conditions: resource.judgmentConfig.conditions.map(condition => condition.id === conditionId
              ? {
                  ...condition,
                  variableSelector,
                  comparisonOperator,
                  value: getConditionValue(metricOption?.valueType, comparisonOperator),
                }
              : condition),
          },
        }
      }),
    }))
  },
  updateConditionOperator: (resourceType, resourceId, conditionId, operator) => {
    set((state) => {
      return {
        resources: updateResourceState(state.resources, resourceType, resourceId, currentResource => ({
          ...currentResource,
          judgmentConfig: {
            ...currentResource.judgmentConfig,
            conditions: currentResource.judgmentConfig.conditions.map((condition) => {
              if (condition.id !== conditionId)
                return condition

              const metricOption = buildConditionMetricOptions(currentResource.metrics)
                .find(option =>
                  option.variableSelector[0] === condition.variableSelector?.[0]
                  && option.variableSelector[1] === condition.variableSelector?.[1],
                )

              return {
                ...condition,
                comparisonOperator: operator,
                value: getConditionValue(metricOption?.valueType, operator, condition.value),
              }
            }),
          },
        })),
      }
    })
  },
  updateConditionValue: (resourceType, resourceId, conditionId, value) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        judgmentConfig: {
          ...resource.judgmentConfig,
          conditions: resource.judgmentConfig.conditions.map(condition => condition.id === conditionId ? { ...condition, value } : condition),
        },
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
  setUploadedFile: (resourceType, resourceId, uploadedFile) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        uploadedFileId: uploadedFile?.id ?? null,
        uploadedFileName: uploadedFile?.name ?? null,
      })),
    }))
  },
  setUploadedFileName: (resourceType, resourceId, uploadedFileName) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        uploadedFileId: null,
        uploadedFileName,
      })),
    }))
  },
  setSelectedRunId: (resourceType, resourceId, runId) => {
    set(state => ({
      resources: updateResourceState(state.resources, resourceType, resourceId, resource => ({
        ...resource,
        selectedRunId: runId,
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

export const useIsEvaluationConfigDirty = (resourceType: EvaluationResourceType, resourceId: string) => {
  const resourceKey = buildResourceKey(resourceType, resourceId)

  return useEvaluationStore((state) => {
    const resource = state.resources[resourceKey] ?? (initialResourceCache[resourceKey] ??= buildInitialState(resourceType))
    const initialResource = state.initialResources[resourceKey] ?? buildInitialState(resourceType)

    return !isEqual(
      pickConfigComparableState(resource),
      pickConfigComparableState(initialResource),
    )
  })
}

export const getAllowedOperators = (
  metrics: EvaluationResourceState['metrics'],
  variableSelector: [string, string] | null,
) => {
  return getAllowedOperatorsFromUtils(metrics, variableSelector)
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
