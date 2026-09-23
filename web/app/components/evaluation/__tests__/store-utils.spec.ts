import type { EvaluationResourceState } from '../types'
import { describe, expect, it } from 'vitest'
import { isEvaluationRunActive, shouldPollEvaluationLogs } from '../queries'
import {
  buildEvaluationConfigPayload,
  buildInitialState,
  buildStateFromEvaluationConfig,
  createBuiltinMetric,
  createCustomMetric,
  isEvaluationRunnable,
  resolveMetricOption,
} from '../store-utils'

const DATASET_ID = 'dataset-1'

const buildResourceState = (
  overrides: Partial<EvaluationResourceState> = {},
): EvaluationResourceState => ({
  ...buildInitialState('apps'),
  ...overrides,
})

describe('evaluation payloads', () => {
  it('uses the dataset ID for judgment and never sends retrieval node info', () => {
    const metric = createBuiltinMetric(
      resolveMetricOption('context_precision'),
      [{ node_id: 'retrieval-node', title: 'Knowledge Retrieval', type: 'knowledge-retrieval' }],
      0.91,
    )
    const state = buildResourceState({
      judgeModelId: 'openai::gpt-4.1-mini',
      metrics: [metric],
    })

    expect(buildEvaluationConfigPayload(state, 'datasets', DATASET_ID)).toMatchObject({
      default_metrics: [
        {
          metric: 'context_precision',
          node_info_list: [],
        },
      ],
      judgment_config: {
        logical_operator: 'and',
        conditions: [
          {
            comparison_operator: '≥',
            value: '0.91',
            variable_selector: [DATASET_ID, 'context_precision'],
          },
        ],
      },
    })
  })

  it('keeps workflow node IDs for app evaluation', () => {
    const metric = createBuiltinMetric(resolveMetricOption('faithfulness'), [
      { node_id: 'llm-node', title: 'LLM', type: 'llm' },
    ])
    const state = buildResourceState({
      judgeModelId: 'openai::gpt-4.1-mini',
      judgmentConfig: {
        logicalOperator: 'and',
        conditions: [
          {
            comparisonOperator: '≥',
            id: 'condition-1',
            value: '0.8',
            variableSelector: ['llm-node', 'faithfulness'],
          },
        ],
      },
      metrics: [metric],
    })

    expect(buildEvaluationConfigPayload(state, 'apps', 'app-1')).toMatchObject({
      default_metrics: [
        {
          metric: 'faithfulness',
          node_info_list: [{ node_id: 'llm-node' }],
        },
      ],
      judgment_config: {
        conditions: [{ variable_selector: ['llm-node', 'faithfulness'] }],
      },
    })
  })

  it('supports a custom-only evaluation without a judge model and serializes variable references', () => {
    const metric = createCustomMetric()
    metric.customConfig = {
      mappings: [
        {
          id: 'mapping-1',
          inputVariableId: 'answer',
          outputVariableId: 'node.output',
        },
      ],
      outputs: [{ id: 'score', valueType: 'number' }],
      workflowAppId: 'evaluator-app',
      workflowId: 'evaluator-workflow',
      workflowName: 'Evaluator',
    }
    const state = buildResourceState({ metrics: [metric] })

    const payload = buildEvaluationConfigPayload(state, 'apps', 'app-1')

    expect(payload).toEqual(
      expect.objectContaining({
        customized_metrics: expect.objectContaining({
          evaluation_workflow_id: 'evaluator-app',
          input_fields: { answer: '{{#node.output#}}' },
        }),
      }),
    )
    expect(payload).not.toHaveProperty('evaluation_model')
    expect(payload).not.toHaveProperty('evaluation_model_provider')
    expect(isEvaluationRunnable(state)).toBe(true)
  })

  it('still requires a judge model when built-in metrics are selected', () => {
    const state = buildResourceState({
      metrics: [createBuiltinMetric(resolveMetricOption('answer_relevancy'))],
    })

    expect(buildEvaluationConfigPayload(state, 'apps', 'app-1')).toBeNull()
    expect(isEvaluationRunnable(state)).toBe(false)
  })

  it('allows a configured custom evaluator with no input mappings', () => {
    const metric = createCustomMetric()
    metric.customConfig = {
      mappings: [],
      outputs: [{ id: 'score', valueType: 'number' }],
      workflowAppId: 'evaluator-app',
      workflowId: 'evaluator-workflow',
      workflowName: 'Evaluator',
    }

    expect(isEvaluationRunnable(buildResourceState({ metrics: [metric] }))).toBe(true)
  })
})

describe('dataset config hydration', () => {
  it('restores thresholds only from selectors scoped by the dataset ID', () => {
    const state = buildStateFromEvaluationConfig('datasets', DATASET_ID, {
      default_metrics: [
        {
          metric: 'context_recall',
          node_info_list: [],
          value_type: 'number',
        },
      ],
      judgment_config: {
        logical_operator: 'and',
        conditions: [
          {
            comparison_operator: '≥',
            value: '0.1',
            variable_selector: ['retrieval-node', 'context_recall'],
          },
          {
            comparison_operator: '≥',
            value: '0.93',
            variable_selector: [DATASET_ID, 'context_recall'],
          },
        ],
      },
    })

    expect(state.metrics[0]?.threshold).toBe(0.93)
    expect(state.judgmentConfig.conditions).toEqual([])
  })
})

describe('evaluation polling', () => {
  it('polls while any run is pending or running', () => {
    expect(shouldPollEvaluationLogs(['completed', 'running'])).toBe(true)
    expect(isEvaluationRunActive('pending')).toBe(true)
  })

  it('stops polling after runs reach terminal states', () => {
    expect(shouldPollEvaluationLogs(['completed', 'failed', 'cancelled'])).toBe(false)
    expect(isEvaluationRunActive('cancelled')).toBe(false)
  })
})
