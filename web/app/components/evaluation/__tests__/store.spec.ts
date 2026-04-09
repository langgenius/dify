import type { EvaluationConfig } from '@/types/evaluation'
import { getEvaluationMockConfig } from '../mock'
import {
  getAllowedOperators,
  isCustomMetricConfigured,
  requiresConditionValue,
  useEvaluationStore,
} from '../store'

describe('evaluation store', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {} })
  })

  it('should configure a custom metric mapping to a valid state', () => {
    const resourceType = 'apps'
    const resourceId = 'app-1'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const initialMetric = useEvaluationStore.getState().resources['apps:app-1'].metrics.find(metric => metric.kind === 'custom-workflow')
    expect(initialMetric).toBeDefined()
    expect(isCustomMetricConfigured(initialMetric!)).toBe(false)

    store.setCustomMetricWorkflow(resourceType, resourceId, initialMetric!.id, {
      workflowId: config.workflowOptions[0].id,
      workflowAppId: 'custom-workflow-app-id',
      workflowName: config.workflowOptions[0].label,
    })
    store.syncCustomMetricMappings(resourceType, resourceId, initialMetric!.id, ['query'])
    const syncedMetric = useEvaluationStore.getState().resources['apps:app-1'].metrics.find(metric => metric.id === initialMetric!.id)
    store.updateCustomMetricMapping(resourceType, resourceId, initialMetric!.id, syncedMetric!.customConfig!.mappings[0].id, {
      outputVariableId: 'answer',
    })

    const configuredMetric = useEvaluationStore.getState().resources['apps:app-1'].metrics.find(metric => metric.id === initialMetric!.id)
    expect(isCustomMetricConfigured(configuredMetric!)).toBe(true)
    expect(configuredMetric!.customConfig!.workflowAppId).toBe('custom-workflow-app-id')
    expect(configuredMetric!.customConfig!.workflowName).toBe(config.workflowOptions[0].label)
  })

  it('should only add one custom metric', () => {
    const resourceType = 'apps'
    const resourceId = 'app-custom-limit'
    const store = useEvaluationStore.getState()

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    expect(
      useEvaluationStore
        .getState()
        .resources['apps:app-custom-limit']
        .metrics
        .filter(metric => metric.kind === 'custom-workflow'),
    ).toHaveLength(1)
  })

  it('should add and remove builtin metrics', () => {
    const resourceType = 'apps'
    const resourceId = 'app-2'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, config.builtinMetrics[1].id)

    const addedMetric = useEvaluationStore.getState().resources['apps:app-2'].metrics.find(metric => metric.optionId === config.builtinMetrics[1].id)
    expect(addedMetric).toBeDefined()

    store.removeMetric(resourceType, resourceId, addedMetric!.id)

    expect(useEvaluationStore.getState().resources['apps:app-2'].metrics.some(metric => metric.id === addedMetric!.id)).toBe(false)
  })

  it('should upsert builtin metric node selections', () => {
    const resourceType = 'apps'
    const resourceId = 'app-4'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)
    const metricId = config.builtinMetrics[0].id

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, metricId, [
      { node_id: 'node-1', title: 'Answer Node', type: 'answer' },
    ])

    store.addBuiltinMetric(resourceType, resourceId, metricId, [
      { node_id: 'node-2', title: 'Retriever Node', type: 'retriever' },
    ])

    const metric = useEvaluationStore.getState().resources['apps:app-4'].metrics.find(item => item.optionId === metricId)

    expect(metric?.nodeInfoList).toEqual([
      { node_id: 'node-2', title: 'Retriever Node', type: 'retriever' },
    ])
    expect(useEvaluationStore.getState().resources['apps:app-4'].metrics.filter(item => item.optionId === metricId)).toHaveLength(1)
  })

  it('should update condition groups and adapt operators to field types', () => {
    const resourceType = 'datasets'
    const resourceId = 'dataset-1'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)

    const initialGroup = useEvaluationStore.getState().resources['datasets:dataset-1'].conditions[0]
    store.setConditionGroupOperator(resourceType, resourceId, initialGroup.id, 'or')
    store.addConditionGroup(resourceType, resourceId)

    const booleanField = config.fieldOptions.find(field => field.type === 'boolean')!
    const currentItem = useEvaluationStore.getState().resources['datasets:dataset-1'].conditions[0].items[0]
    store.updateConditionField(resourceType, resourceId, initialGroup.id, currentItem.id, booleanField.id)

    const updatedGroup = useEvaluationStore.getState().resources['datasets:dataset-1'].conditions[0]
    expect(updatedGroup.logicalOperator).toBe('or')
    expect(updatedGroup.items[0].operator).toBe('is')
    expect(getAllowedOperators(resourceType, booleanField.id)).toEqual(['is', 'is_not'])
  })

  it('should clear values for empty operators', () => {
    const resourceType = 'apps'
    const resourceId = 'app-3'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)

    const stringField = config.fieldOptions.find(field => field.type === 'string')!
    const item = useEvaluationStore.getState().resources['apps:app-3'].conditions[0].items[0]

    store.updateConditionField(resourceType, resourceId, useEvaluationStore.getState().resources['apps:app-3'].conditions[0].id, item.id, stringField.id)
    store.updateConditionOperator(resourceType, resourceId, useEvaluationStore.getState().resources['apps:app-3'].conditions[0].id, item.id, 'is_empty')

    const updatedItem = useEvaluationStore.getState().resources['apps:app-3'].conditions[0].items[0]

    expect(getAllowedOperators(resourceType, stringField.id)).toEqual(['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'])
    expect(requiresConditionValue('is_empty')).toBe(false)
    expect(updatedItem.value).toBeNull()
  })

  it('should hydrate resource state from evaluation config', () => {
    const resourceType = 'apps'
    const resourceId = 'app-5'
    const store = useEvaluationStore.getState()
    const config: EvaluationConfig = {
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [{
        metric: 'faithfulness',
        node_info_list: [
          { node_id: 'node-1', title: 'Retriever', type: 'retriever' },
        ],
      }],
      customized_metrics: {
        evaluation_workflow_id: 'workflow-precision-review',
        input_fields: {
          query: 'answer',
        },
      },
      judgement_conditions: [{
        logical_operator: 'or',
        items: [{
          field_id: 'system.has_context',
          operator: 'is',
          value: true,
        }],
      }],
    }

    store.ensureResource(resourceType, resourceId)
    store.setBatchTab(resourceType, resourceId, 'history')
    store.setUploadedFileName(resourceType, resourceId, 'batch.csv')
    useEvaluationStore.setState(state => ({
      resources: {
        ...state.resources,
        'apps:app-5': {
          ...state.resources['apps:app-5'],
          batchRecords: [{
            id: 'batch-1',
            fileName: 'batch.csv',
            status: 'success',
            startedAt: '10:00:00',
            summary: 'App evaluation batch',
          }],
        },
      },
    }))
    store.hydrateResource(resourceType, resourceId, config)

    const hydratedState = useEvaluationStore.getState().resources['apps:app-5']

    expect(hydratedState.judgeModelId).toBe('openai::gpt-4o-mini')
    expect(hydratedState.metrics).toHaveLength(2)
    expect(hydratedState.metrics[0].optionId).toBe('faithfulness')
    expect(hydratedState.metrics[0].threshold).toBe(0.85)
    expect(hydratedState.metrics[0].nodeInfoList).toEqual([
      { node_id: 'node-1', title: 'Retriever', type: 'retriever' },
    ])
    expect(hydratedState.metrics[1].kind).toBe('custom-workflow')
    expect(hydratedState.metrics[1].customConfig?.workflowId).toBe('workflow-precision-review')
    expect(hydratedState.metrics[1].customConfig?.mappings[0].inputVariableId).toBe('query')
    expect(hydratedState.metrics[1].customConfig?.mappings[0].outputVariableId).toBe('answer')
    expect(hydratedState.conditions[0].logicalOperator).toBe('or')
    expect(hydratedState.conditions[0].items[0]).toMatchObject({
      fieldId: 'system.has_context',
      operator: 'is',
      value: true,
    })
    expect(hydratedState.activeBatchTab).toBe('history')
    expect(hydratedState.uploadedFileName).toBe('batch.csv')
    expect(hydratedState.batchRecords).toHaveLength(1)
  })
})
