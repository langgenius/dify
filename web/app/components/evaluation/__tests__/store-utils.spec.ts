import type { EvaluationResourceState } from '../types'
import {
  buildConditionItem,
  buildEvaluationConfigPayload,
  buildEvaluationRunRequest,
  buildEvaluationTemplateConfigPayload,
  buildStateFromEvaluationConfig,
  createBuiltinMetric,
  createCustomMetric,
  getIncompleteConditionIds,
  isEvaluationRunnable,
  resolveMetricOption,
} from '../store-utils'

const createResource = (
  overrides: Partial<EvaluationResourceState> = {},
): EvaluationResourceState => ({
  evaluationFramework: 'ragas',
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
      evaluation_framework: 'ragas',
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
      evaluation_framework: 'ragas',
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

  it('serializes combined dataset judgments with the dataset id and no node ids', () => {
    const resource = createResource({
      judgeModelId: 'openai::gpt-4o-mini',
      metrics: [
        createBuiltinMetric(resolveMetricOption('context-precision'), [
          { node_id: 'stale-node-id', title: 'Retriever', type: 'knowledge-retrieval' },
        ]),
        createBuiltinMetric(resolveMetricOption('context-recall')),
      ],
      judgmentConfig: {
        logicalOperator: 'or',
        conditions: [
          {
            id: 'condition-1',
            variableSelector: ['dataset-1', 'context-precision'],
            comparisonOperator: '≥',
            value: '0.9',
          },
          {
            id: 'condition-2',
            variableSelector: ['dataset-1', 'context-recall'],
            comparisonOperator: '>',
            value: '0.6',
          },
        ],
      },
    })

    expect(buildEvaluationConfigPayload(resource, 'datasets', 'dataset-1')).toEqual({
      evaluation_framework: 'ragas',
      evaluation_model: 'gpt-4o-mini',
      evaluation_model_provider: 'openai',
      default_metrics: [
        {
          metric: 'context-precision',
          value_type: 'number',
          node_info_list: [],
        },
        {
          metric: 'context-recall',
          value_type: 'number',
          node_info_list: [],
        },
      ],
      customized_metrics: null,
      judgment_config: {
        logical_operator: 'or',
        conditions: [
          {
            variable_selector: ['dataset-1', 'context-precision'],
            comparison_operator: '≥',
            value: '0.9',
          },
          {
            variable_selector: ['dataset-1', 'context-recall'],
            comparison_operator: '>',
            value: '0.6',
          },
        ],
      },
    })
  })

  it('does not create implicit conditions for selected dataset metrics', () => {
    const resource = createResource({
      judgeModelId: 'openai::gpt-4o-mini',
      metrics: [createBuiltinMetric(resolveMetricOption('context-precision'))],
    })

    expect(
      buildEvaluationConfigPayload(resource, 'datasets', 'dataset-1')?.judgment_config,
    ).toBeNull()
  })

  it('restores saved dataset conditions for editing', () => {
    const resource = buildStateFromEvaluationConfig('datasets', 'dataset-1', {
      default_metrics: [
        { metric: 'context-precision', value_type: 'number', node_info_list: [] },
        { metric: 'context-recall', value_type: 'number', node_info_list: [] },
      ],
      judgment_config: {
        logical_operator: 'or',
        conditions: [
          {
            variable_selector: ['dataset-1', 'context-precision'],
            comparison_operator: '≥',
            value: '0.85',
          },
          {
            variable_selector: ['dataset-1', 'context-recall'],
            comparison_operator: '<',
            value: '0.6',
          },
        ],
      },
    })

    expect(resource.judgmentConfig).toMatchObject({
      logicalOperator: 'or',
      conditions: [
        {
          variableSelector: ['dataset-1', 'context-precision'],
          comparisonOperator: '≥',
          value: '0.85',
        },
        {
          variableSelector: ['dataset-1', 'context-recall'],
          comparisonOperator: '<',
          value: '0.6',
        },
      ],
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

  it('defaults legacy configurations to Ragas and restores a saved framework', () => {
    expect(buildStateFromEvaluationConfig('apps', 'app-1', {}).evaluationFramework).toBe('ragas')

    const savedConfig = { default_metrics: [], evaluation_framework: 'deepeval' as const }
    expect(buildStateFromEvaluationConfig('apps', 'app-1', savedConfig).evaluationFramework).toBe(
      'deepeval',
    )
  })

  it('includes the selected framework in evaluation run requests', () => {
    const resource = createResource({
      evaluationFramework: 'deepeval',
      judgeModelId: 'openai::gpt-4o-mini',
      metrics: [
        createBuiltinMetric(resolveMetricOption('answer_correctness'), [
          { node_id: 'llm-1', title: 'Answer', type: 'llm' },
        ]),
      ],
    })

    expect(buildEvaluationRunRequest(resource, 'file-1', 'apps', 'app-1')).toMatchObject({
      evaluation_framework: 'deepeval',
      file_id: 'file-1',
    })
  })

  it('keeps unsupported metrics selected but blocks DeepEval submission', () => {
    const resource = createResource({
      evaluationFramework: 'deepeval',
      judgeModelId: 'openai::gpt-4o-mini',
      metrics: [
        createBuiltinMetric(resolveMetricOption('semantic_similarity'), [
          { node_id: 'llm-1', title: 'Answer', type: 'llm' },
        ]),
      ],
    })

    expect(resource.metrics).toHaveLength(1)
    expect(isEvaluationRunnable(resource)).toBe(false)
    expect(buildEvaluationConfigPayload(resource, 'apps', 'app-1')).toBeNull()
    expect(buildEvaluationRunRequest(resource, 'file-1', 'apps', 'app-1')).toBeNull()
    expect(isEvaluationRunnable({ ...resource, evaluationFramework: 'ragas' })).toBe(true)
  })

  it('starts number conditions at "≥" because scores are compared against a threshold', () => {
    const metrics = [
      createBuiltinMetric(resolveMetricOption('answer_correctness'), [
        { node_id: 'llm-1', title: 'LLM', type: 'llm' },
      ]),
    ]

    expect(buildConditionItem(metrics, 'apps', 'app-1').comparisonOperator).toBe('≥')
  })

  it('finds conditions that would be saved without a value their operator needs', () => {
    const metrics = [
      createBuiltinMetric(resolveMetricOption('answer_correctness'), [
        { node_id: 'llm-1', title: 'LLM', type: 'llm' },
      ]),
    ]
    const condition = buildConditionItem(metrics, 'apps', 'app-1')
    const resource = createResource({
      metrics,
      judgmentConfig: {
        logicalOperator: 'and',
        conditions: [
          { ...condition, id: 'complete', value: '0.7' },
          { ...condition, id: 'empty', value: null },
          { ...condition, id: 'no-value-needed', comparisonOperator: 'is null', value: null },
          { ...condition, id: 'no-metric', variableSelector: null, value: '1' },
        ],
      },
    })

    expect(getIncompleteConditionIds(resource, 'apps', 'app-1')).toEqual(['empty', 'no-metric'])
  })
})
