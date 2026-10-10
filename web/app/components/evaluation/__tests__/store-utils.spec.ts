import type { EvaluationResourceState } from '../types'
import {
  buildEvaluationConfigPayload,
  buildEvaluationTemplateConfigPayload,
  buildStateFromEvaluationConfig,
  createBuiltinMetric,
  createCustomMetric,
  isEvaluationRunnable,
  resolveMetricOption,
} from '../store-utils'

const createResource = (
  overrides: Partial<EvaluationResourceState> = {},
): EvaluationResourceState => ({
  judgeModelId: null,
  metrics: [],
  judgmentConfig: {
    logicalOperator: 'and',
    conditions: [],
  },
  activeBatchTab: 'input-fields',
  uploadedFileId: null,
  uploadedFileName: null,
  selectedRunId: null,
  ...overrides,
})

describe('evaluation store utils', () => {
  it('allows a configured custom-only evaluator without a judge model', () => {
    const customMetric = createCustomMetric()
    const resource = createResource({
      metrics: [
        {
          ...customMetric,
          customConfig: {
            ...customMetric.customConfig!,
            workflowId: 'workflow-1',
            workflowAppId: 'app-1',
            outputs: [{ id: 'score', valueType: 'number' }],
          },
        },
      ],
    })

    expect(isEvaluationRunnable(resource)).toBe(true)
    expect(buildEvaluationConfigPayload(resource, 'apps', 'app-under-test')).toEqual({
      default_metrics: [],
      customized_metrics: {
        evaluation_workflow_id: 'app-1',
        input_fields: {},
        output_fields: [{ variable: 'score', value_type: 'number' }],
      },
      judgment_config: null,
    })
  })

  it('still requires a judge model for builtin metrics', () => {
    const resource = createResource({
      metrics: [
        createBuiltinMetric(resolveMetricOption('answer-correctness'), [
          { node_id: 'llm-1', title: 'Answer', type: 'llm' },
        ]),
      ],
    })

    expect(isEvaluationRunnable(resource)).toBe(false)
    expect(buildEvaluationConfigPayload(resource, 'apps', 'app-1')).toBeNull()
    expect(buildEvaluationTemplateConfigPayload(resource, 'apps', 'app-1')).toEqual({
      default_metrics: [
        {
          metric: 'answer-correctness',
          node_info_list: [{ node_id: 'llm-1', title: 'Answer', type: 'llm' }],
          value_type: 'number',
        },
      ],
      customized_metrics: null,
      judgment_config: null,
    })
  })

  it('serializes dataset judgments with the dataset id and no node ids', () => {
    const resource = createResource({
      judgeModelId: 'openai::gpt-4o-mini',
      metrics: [
        createBuiltinMetric(
          resolveMetricOption('context-precision'),
          [{ node_id: 'stale-node-id', title: 'Retriever', type: 'knowledge-retrieval' }],
          0.9,
        ),
      ],
    })

    expect(buildEvaluationConfigPayload(resource, 'datasets', 'dataset-1')).toEqual({
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [
        {
          metric: 'context-precision',
          value_type: 'number',
          node_info_list: [],
        },
      ],
      customized_metrics: null,
      judgment_config: {
        logical_operator: 'and',
        conditions: [
          {
            variable_selector: ['dataset-1', 'context-precision'],
            comparison_operator: '≥',
            value: '0.9',
          },
        ],
      },
    })
  })

  it('serializes custom workflow evaluators for Agent V2 targets', () => {
    const customMetric = createCustomMetric()
    const resource = createResource({
      judgeModelId: 'openai::gpt-4o-mini',
      metrics: [
        createBuiltinMetric(resolveMetricOption('task_completion'), [
          { node_id: 'agent-1', title: 'Research Agent', type: 'agent' },
        ]),
        {
          ...customMetric,
          customConfig: {
            ...customMetric.customConfig!,
            workflowId: 'workflow-1',
            workflowAppId: 'app-1',
            mappings: [
              {
                id: 'mapping-1',
                inputVariableId: 'answer',
                outputVariableId: 'agent.output',
              },
            ],
            outputs: [{ id: 'score', valueType: 'number' }],
          },
        },
      ],
    })

    expect(buildEvaluationConfigPayload(resource, 'agents', 'agent-1')).toMatchObject({
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [
        {
          metric: 'task_completion',
          node_info_list: [{ node_id: 'agent-1', title: 'Research Agent', type: 'agent' }],
          value_type: 'number',
        },
      ],
      customized_metrics: {
        evaluation_workflow_id: 'app-1',
        input_fields: {
          answer: '{{#agent.output#}}',
        },
        output_fields: [{ variable: 'score', value_type: 'number' }],
      },
    })
  })

  it('restores a custom workflow evaluator for an Agent V2 target', () => {
    const resource = buildStateFromEvaluationConfig('agents', 'agent-1', {
      default_metrics: [],
      customized_metrics: {
        evaluation_workflow_id: 'evaluator-app',
        input_fields: {
          answer: '{{#agent.output#}}',
        },
        output_fields: [{ variable: 'score', value_type: 'number' }],
      },
      judgment_config: null,
    })

    expect(resource.metrics).toHaveLength(1)
    expect(resource.metrics[0]).toMatchObject({
      kind: 'custom-workflow',
      customConfig: {
        workflowId: 'evaluator-app',
        workflowAppId: 'evaluator-app',
        mappings: [
          {
            inputVariableId: 'answer',
            outputVariableId: '{{#agent.output#}}',
          },
        ],
        outputs: [{ id: 'score', valueType: 'number' }],
      },
    })
  })
})
