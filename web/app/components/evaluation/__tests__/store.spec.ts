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
    store.syncCustomMetricOutputs(resourceType, resourceId, initialMetric!.id, [{
      id: 'score',
      valueType: 'number',
    }])

    const syncedMetric = useEvaluationStore.getState().resources['apps:app-1'].metrics.find(metric => metric.id === initialMetric!.id)
    store.updateCustomMetricMapping(resourceType, resourceId, initialMetric!.id, syncedMetric!.customConfig!.mappings[0].id, {
      outputVariableId: 'answer',
    })

    const configuredMetric = useEvaluationStore.getState().resources['apps:app-1'].metrics.find(metric => metric.id === initialMetric!.id)
    expect(isCustomMetricConfigured(configuredMetric!)).toBe(true)
    expect(configuredMetric!.customConfig!.workflowAppId).toBe('custom-workflow-app-id')
    expect(configuredMetric!.customConfig!.workflowName).toBe(config.workflowOptions[0].label)
    expect(configuredMetric!.customConfig!.outputs).toEqual([{ id: 'score', valueType: 'number' }])
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

  it('should upsert builtin metric node selections and prune stale conditions', () => {
    const resourceType = 'apps'
    const resourceId = 'app-4'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)
    const metricId = config.builtinMetrics[0].id

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, metricId, [
      { node_id: 'node-1', title: 'Answer Node', type: 'answer' },
    ])
    store.addCondition(resourceType, resourceId)

    store.addBuiltinMetric(resourceType, resourceId, metricId, [
      { node_id: 'node-2', title: 'Retriever Node', type: 'retriever' },
    ])

    const state = useEvaluationStore.getState().resources['apps:app-4']
    const metric = state.metrics.find(item => item.optionId === metricId)

    expect(metric?.nodeInfoList).toEqual([
      { node_id: 'node-2', title: 'Retriever Node', type: 'retriever' },
    ])
    expect(state.metrics.filter(item => item.optionId === metricId)).toHaveLength(1)
    expect(state.judgmentConfig.conditions).toHaveLength(0)
  })

  it('should build numeric conditions from selected metrics', () => {
    const resourceType = 'apps'
    const resourceId = 'app-conditions'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, config.builtinMetrics[0].id, [
      { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
    ])
    store.setConditionLogicalOperator(resourceType, resourceId, 'or')
    store.addCondition(resourceType, resourceId)

    const state = useEvaluationStore.getState().resources['apps:app-conditions']
    const condition = state.judgmentConfig.conditions[0]

    expect(state.judgmentConfig.logicalOperator).toBe('or')
    expect(condition.variableSelector).toEqual(['node-answer', 'answer-correctness'])
    expect(condition.comparisonOperator).toBe('=')
    expect(getAllowedOperators(state.metrics, condition.variableSelector)).toEqual(['=', '≠', '>', '<', '≥', '≤', 'is null', 'is not null'])
  })

  it('should add a condition from the selected custom metric output', () => {
    const resourceType = 'apps'
    const resourceId = 'app-condition-selector'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const customMetric = useEvaluationStore.getState().resources['apps:app-condition-selector'].metrics.find(metric => metric.kind === 'custom-workflow')!
    store.setCustomMetricWorkflow(resourceType, resourceId, customMetric.id, {
      workflowId: config.workflowOptions[0].id,
      workflowAppId: 'custom-workflow-app-id',
      workflowName: config.workflowOptions[0].label,
    })
    store.syncCustomMetricOutputs(resourceType, resourceId, customMetric.id, [{
      id: 'reason',
      valueType: 'string',
    }])

    store.addCondition(resourceType, resourceId, [config.workflowOptions[0].id, 'reason'])

    const condition = useEvaluationStore.getState().resources['apps:app-condition-selector'].judgmentConfig.conditions[0]

    expect(condition.variableSelector).toEqual([config.workflowOptions[0].id, 'reason'])
    expect(condition.comparisonOperator).toBe('contains')
    expect(condition.value).toBeNull()
  })

  it('should clear values for operators without values', () => {
    const resourceType = 'apps'
    const resourceId = 'app-3'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const customMetric = useEvaluationStore.getState().resources['apps:app-3'].metrics.find(metric => metric.kind === 'custom-workflow')!
    store.setCustomMetricWorkflow(resourceType, resourceId, customMetric.id, {
      workflowId: config.workflowOptions[0].id,
      workflowAppId: 'custom-workflow-app-id',
      workflowName: config.workflowOptions[0].label,
    })
    store.syncCustomMetricOutputs(resourceType, resourceId, customMetric.id, [{
      id: 'reason',
      valueType: 'string',
    }])
    store.addCondition(resourceType, resourceId)

    const condition = useEvaluationStore.getState().resources['apps:app-3'].judgmentConfig.conditions[0]

    store.updateConditionMetric(resourceType, resourceId, condition.id, [config.workflowOptions[0].id, 'reason'])
    store.updateConditionValue(resourceType, resourceId, condition.id, 'needs follow-up')
    store.updateConditionOperator(resourceType, resourceId, condition.id, 'empty')

    const updatedCondition = useEvaluationStore.getState().resources['apps:app-3'].judgmentConfig.conditions[0]

    expect(requiresConditionValue('empty')).toBe(false)
    expect(updatedCondition.value).toBeNull()
  })

  it('should hydrate resource state from judgment_config', () => {
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
        output_fields: [{
          variable: 'reason',
          value_type: 'string',
        }],
      },
      judgment_config: {
        logical_operator: 'or',
        conditions: [{
          variable_selector: ['node-1', 'faithfulness'],
          comparison_operator: '≥',
          value: '0.9',
        }],
      },
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
    expect(hydratedState.metrics[1].customConfig?.outputs).toEqual([{ id: 'reason', valueType: 'string' }])
    expect(hydratedState.judgmentConfig.logicalOperator).toBe('or')
    expect(hydratedState.judgmentConfig.conditions[0]).toMatchObject({
      variableSelector: ['node-1', 'faithfulness'],
      comparisonOperator: '≥',
      value: '0.9',
    })
    expect(hydratedState.activeBatchTab).toBe('history')
    expect(hydratedState.uploadedFileName).toBe('batch.csv')
    expect(hydratedState.batchRecords).toHaveLength(1)
  })
})
