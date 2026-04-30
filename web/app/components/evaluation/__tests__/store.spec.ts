import type { EvaluationConfig } from '@/types/evaluation'
import {
  getAllowedOperators,
  isCustomMetricConfigured,
  requiresConditionValue,
  useEvaluationStore,
} from '../store'
import { buildEvaluationConfigPayload, buildEvaluationRunRequest } from '../store-utils'

const customWorkflow = {
  id: 'workflow-precision-review',
  appId: 'custom-workflow-app-id',
  name: 'Precision Review Workflow',
}

describe('evaluation store', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {}, initialResources: {} })
  })

  it('should configure a custom metric mapping to a valid state', () => {
    const resourceType = 'apps'
    const resourceId = 'app-1'
    const store = useEvaluationStore.getState()

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const initialMetric = useEvaluationStore.getState().resources['apps:app-1'].metrics.find(metric => metric.kind === 'custom-workflow')
    expect(initialMetric).toBeDefined()
    expect(isCustomMetricConfigured(initialMetric!)).toBe(false)

    store.setCustomMetricWorkflow(resourceType, resourceId, initialMetric!.id, {
      workflowId: customWorkflow.id,
      workflowAppId: customWorkflow.appId,
      workflowName: customWorkflow.name,
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
    expect(configuredMetric!.customConfig!.workflowAppId).toBe(customWorkflow.appId)
    expect(configuredMetric!.customConfig!.workflowName).toBe(customWorkflow.name)
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

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, 'faithfulness')

    const addedMetric = useEvaluationStore.getState().resources['apps:app-2'].metrics.find(metric => metric.optionId === 'faithfulness')
    expect(addedMetric).toBeDefined()

    store.removeMetric(resourceType, resourceId, addedMetric!.id)

    expect(useEvaluationStore.getState().resources['apps:app-2'].metrics.some(metric => metric.id === addedMetric!.id)).toBe(false)
  })

  it('should upsert builtin metric node selections and prune stale conditions', () => {
    const resourceType = 'apps'
    const resourceId = 'app-4'
    const store = useEvaluationStore.getState()
    const metricId = 'answer-correctness'

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

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [
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

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const customMetric = useEvaluationStore.getState().resources['apps:app-condition-selector'].metrics.find(metric => metric.kind === 'custom-workflow')!
    store.setCustomMetricWorkflow(resourceType, resourceId, customMetric.id, {
      workflowId: customWorkflow.id,
      workflowAppId: customWorkflow.appId,
      workflowName: customWorkflow.name,
    })
    store.syncCustomMetricOutputs(resourceType, resourceId, customMetric.id, [{
      id: 'reason',
      valueType: 'string',
    }])

    store.addCondition(resourceType, resourceId, [customWorkflow.id, 'reason'])

    const condition = useEvaluationStore.getState().resources['apps:app-condition-selector'].judgmentConfig.conditions[0]

    expect(condition.variableSelector).toEqual([customWorkflow.id, 'reason'])
    expect(condition.comparisonOperator).toBe('contains')
    expect(condition.value).toBeNull()
  })

  it('should clear values for operators without values', () => {
    const resourceType = 'apps'
    const resourceId = 'app-3'
    const store = useEvaluationStore.getState()

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const customMetric = useEvaluationStore.getState().resources['apps:app-3'].metrics.find(metric => metric.kind === 'custom-workflow')!
    store.setCustomMetricWorkflow(resourceType, resourceId, customMetric.id, {
      workflowId: customWorkflow.id,
      workflowAppId: customWorkflow.appId,
      workflowName: customWorkflow.name,
    })
    store.syncCustomMetricOutputs(resourceType, resourceId, customMetric.id, [{
      id: 'reason',
      valueType: 'string',
    }])
    store.addCondition(resourceType, resourceId)

    const condition = useEvaluationStore.getState().resources['apps:app-3'].judgmentConfig.conditions[0]

    store.updateConditionMetric(resourceType, resourceId, condition.id, [customWorkflow.id, 'reason'])
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
    expect(hydratedState.metrics[1].customConfig?.workflowAppId).toBe('workflow-precision-review')
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

  it('should build an evaluation config save payload from resource state', () => {
    const resourceType = 'apps'
    const resourceId = 'app-save-config'
    const store = useEvaluationStore.getState()

    store.ensureResource(resourceType, resourceId)
    store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')
    store.addBuiltinMetric(resourceType, resourceId, 'faithfulness', [
      { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
    ])
    store.addCustomMetric(resourceType, resourceId)

    const customMetric = useEvaluationStore.getState().resources['apps:app-save-config'].metrics.find(metric => metric.kind === 'custom-workflow')!
    store.setCustomMetricWorkflow(resourceType, resourceId, customMetric.id, {
      workflowId: 'workflow-precision-review',
      workflowAppId: 'evaluation-workflow-app-id',
      workflowName: 'Precision Review',
    })
    store.syncCustomMetricMappings(resourceType, resourceId, customMetric.id, ['query'])
    store.syncCustomMetricOutputs(resourceType, resourceId, customMetric.id, [{
      id: 'score',
      valueType: 'number',
    }])

    const syncedMetric = useEvaluationStore.getState().resources['apps:app-save-config'].metrics.find(metric => metric.id === customMetric.id)!
    store.updateCustomMetricMapping(resourceType, resourceId, customMetric.id, syncedMetric.customConfig!.mappings[0].id, {
      outputVariableId: '{{#node-answer.output#}}',
    })
    store.addCondition(resourceType, resourceId, ['workflow-precision-review', 'score'])

    const condition = useEvaluationStore.getState().resources['apps:app-save-config'].judgmentConfig.conditions[0]
    store.updateConditionOperator(resourceType, resourceId, condition.id, '≥')
    store.updateConditionValue(resourceType, resourceId, condition.id, '0.8')

    const resource = useEvaluationStore.getState().resources['apps:app-save-config']
    const expectedPayload = {
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [{
        metric: 'faithfulness',
        value_type: 'number',
        node_info_list: [
          { node_id: 'node-faithfulness', title: 'Retriever Node', type: 'retriever' },
        ],
      }],
      customized_metrics: {
        evaluation_workflow_id: 'evaluation-workflow-app-id',
        input_fields: {
          query: '{{#node-answer.output#}}',
        },
        output_fields: [{
          variable: 'score',
          value_type: 'number',
        }],
      },
      judgment_config: {
        logical_operator: 'and',
        conditions: [{
          variable_selector: ['evaluation-workflow-app-id', 'score'],
          comparison_operator: '≥',
          value: '0.8',
        }],
      },
    }

    expect(buildEvaluationConfigPayload(resource, resourceType)).toEqual(expectedPayload)
    expect(buildEvaluationRunRequest(resource, 'file-1', resourceType)).toEqual({
      ...expectedPayload,
      file_id: 'file-1',
    })
  })

  it('should hydrate pipeline metrics from fixed knowledge-index conditions', () => {
    const resourceType = 'datasets'
    const resourceId = 'dataset-hydrate'
    const store = useEvaluationStore.getState()
    const config: EvaluationConfig = {
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [{
        metric: 'context-precision',
        node_info_list: [
          { node_id: 'knowledge-node', title: 'Knowledge Base', type: 'knowledge-index' },
        ],
      }],
      customized_metrics: {
        evaluation_workflow_id: 'should-be-ignored',
        input_fields: {
          query: 'answer',
        },
        output_fields: [{
          variable: 'score',
          value_type: 'number',
        }],
      },
      judgment_config: {
        logical_operator: 'or',
        conditions: [{
          variable_selector: ['knowledge-node', 'context-precision'],
          comparison_operator: '≥',
          value: '0.92',
        }],
      },
    }

    store.hydrateResource(resourceType, resourceId, config)

    const hydratedState = useEvaluationStore.getState().resources['datasets:dataset-hydrate']

    expect(hydratedState.judgeModelId).toBe('openai::gpt-4o-mini')
    expect(hydratedState.metrics).toHaveLength(1)
    expect(hydratedState.metrics[0]).toMatchObject({
      optionId: 'context-precision',
      kind: 'builtin',
      valueType: 'number',
      threshold: 0.92,
      nodeInfoList: [
        { node_id: 'knowledge-node', title: 'Knowledge Base', type: 'knowledge-index' },
      ],
    })
  })

  it('should build pipeline judgment payload from metric thresholds', () => {
    const resourceType = 'datasets'
    const resourceId = 'dataset-save-config'
    const store = useEvaluationStore.getState()
    const knowledgeNodeInfo = [{ node_id: 'knowledge-node', title: 'Knowledge Base', type: 'knowledge-index' }]

    store.ensureResource(resourceType, resourceId)
    store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')
    store.addBuiltinMetric(resourceType, resourceId, 'context-precision', knowledgeNodeInfo)
    store.addBuiltinMetric(resourceType, resourceId, 'context-recall', knowledgeNodeInfo)

    const resourceWithMetrics = useEvaluationStore.getState().resources['datasets:dataset-save-config']
    const contextPrecisionMetric = resourceWithMetrics.metrics.find(metric => metric.optionId === 'context-precision')!
    const contextRecallMetric = resourceWithMetrics.metrics.find(metric => metric.optionId === 'context-recall')!

    store.updateMetricThreshold(resourceType, resourceId, contextPrecisionMetric.id, 0.91)
    store.updateMetricThreshold(resourceType, resourceId, contextRecallMetric.id, 0.88)

    const resource = useEvaluationStore.getState().resources['datasets:dataset-save-config']
    const expectedPayload = {
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [
        {
          metric: 'context-precision',
          value_type: 'number',
          node_info_list: knowledgeNodeInfo,
        },
        {
          metric: 'context-recall',
          value_type: 'number',
          node_info_list: knowledgeNodeInfo,
        },
      ],
      customized_metrics: null,
      judgment_config: {
        logical_operator: 'and',
        conditions: [
          {
            variable_selector: ['knowledge-node', 'context-precision'],
            comparison_operator: '≥',
            value: '0.91',
          },
          {
            variable_selector: ['knowledge-node', 'context-recall'],
            comparison_operator: '≥',
            value: '0.88',
          },
        ],
      },
    }

    expect(buildEvaluationConfigPayload(resource, resourceType)).toEqual(expectedPayload)
    expect(buildEvaluationRunRequest(resource, 'file-1', resourceType)).toEqual({
      ...expectedPayload,
      file_id: 'file-1',
    })
  })
})
