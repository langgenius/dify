import type {
  EvaluationFieldOption,
  EvaluationMockConfig,
  EvaluationResourceType,
  MetricOption,
} from './types'
import { getDefaultMetricDescription } from './default-metric-descriptions'

const judgeModels = [
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    provider: 'OpenAI',
  },
  {
    id: 'claude-3-7-sonnet',
    label: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    provider: 'Google',
  },
]

const builtinMetrics: MetricOption[] = [
  {
    id: 'answer-correctness',
    label: 'Answer Correctness',
    description: getDefaultMetricDescription('answer-correctness'),
    valueType: 'number',
  },
  {
    id: 'faithfulness',
    label: 'Faithfulness',
    description: getDefaultMetricDescription('faithfulness'),
    valueType: 'number',
  },
  {
    id: 'relevance',
    label: 'Relevance',
    description: getDefaultMetricDescription('relevance'),
    valueType: 'number',
  },
  {
    id: 'latency',
    label: 'Latency',
    description: 'Captures runtime responsiveness for the full execution path.',
    valueType: 'number',
  },
  {
    id: 'token-usage',
    label: 'Token Usage',
    description: 'Tracks prompt and completion token consumption for the run.',
    valueType: 'number',
  },
  {
    id: 'tool-success-rate',
    label: 'Tool Success Rate',
    description: 'Measures whether each required tool invocation finishes without failure.',
    valueType: 'number',
  },
]

const pipelineBuiltinMetrics: MetricOption[] = [
  {
    id: 'context-precision',
    label: 'Context Precision',
    description: getDefaultMetricDescription('context-precision'),
    valueType: 'number',
  },
  {
    id: 'context-recall',
    label: 'Context Recall',
    description: getDefaultMetricDescription('context-recall'),
    valueType: 'number',
  },
  {
    id: 'context-relevance',
    label: 'Context Relevance',
    description: getDefaultMetricDescription('context-relevance'),
    valueType: 'number',
  },
]

const workflowOptions = [
  {
    id: 'workflow-precision-review',
    label: 'Precision Review Workflow',
    description: 'Custom evaluator for nuanced quality review.',
    targetVariables: [
      { id: 'query', label: 'query' },
      { id: 'answer', label: 'answer' },
      { id: 'reference', label: 'reference' },
    ],
  },
  {
    id: 'workflow-risk-review',
    label: 'Risk Review Workflow',
    description: 'Custom evaluator for policy and escalation checks.',
    targetVariables: [
      { id: 'input', label: 'input' },
      { id: 'output', label: 'output' },
    ],
  },
]

const workflowFields: EvaluationFieldOption[] = [
  { id: 'app.input.query', label: 'Query', group: 'App Input', type: 'string' },
  { id: 'app.input.locale', label: 'Locale', group: 'App Input', type: 'enum', options: [{ value: 'en-US', label: 'en-US' }, { value: 'zh-Hans', label: 'zh-Hans' }] },
  { id: 'app.output.answer', label: 'Answer', group: 'App Output', type: 'string' },
  { id: 'app.output.score', label: 'Score', group: 'App Output', type: 'number' },
  { id: 'system.has_context', label: 'Has Context', group: 'System', type: 'boolean' },
]

const pipelineFields: EvaluationFieldOption[] = [
  { id: 'dataset.input.document_id', label: 'Document ID', group: 'Dataset', type: 'string' },
  { id: 'dataset.input.chunk_count', label: 'Chunk Count', group: 'Dataset', type: 'number' },
  { id: 'retrieval.output.hit_rate', label: 'Hit Rate', group: 'Retrieval', type: 'number' },
  { id: 'retrieval.output.source', label: 'Source', group: 'Retrieval', type: 'enum', options: [{ value: 'bm25', label: 'BM25' }, { value: 'hybrid', label: 'Hybrid' }] },
  { id: 'pipeline.output.published', label: 'Published', group: 'Output', type: 'boolean' },
]

const snippetFields: EvaluationFieldOption[] = [
  { id: 'snippet.input.blog_url', label: 'Blog URL', group: 'Snippet Input', type: 'string' },
  { id: 'snippet.input.platforms', label: 'Platforms', group: 'Snippet Input', type: 'string' },
  { id: 'snippet.output.content', label: 'Generated Content', group: 'Snippet Output', type: 'string' },
  { id: 'snippet.output.length', label: 'Output Length', group: 'Snippet Output', type: 'number' },
  { id: 'system.requires_review', label: 'Requires Review', group: 'System', type: 'boolean' },
]

export const getEvaluationMockConfig = (resourceType: EvaluationResourceType): EvaluationMockConfig => {
  if (resourceType === 'datasets') {
    return {
      judgeModels,
      builtinMetrics: pipelineBuiltinMetrics,
      workflowOptions,
      fieldOptions: pipelineFields,
      templateFileName: 'pipeline-evaluation-template.csv',
      batchRequirements: [
        'Include one row per retrieval scenario.',
        'Provide the expected source or target chunk for each case.',
        'Keep numeric metrics in plain number format.',
      ],
      historySummaryLabel: 'Pipeline evaluation batch',
    }
  }

  if (resourceType === 'snippets') {
    return {
      judgeModels,
      builtinMetrics,
      workflowOptions,
      fieldOptions: snippetFields,
      templateFileName: 'snippet-evaluation-template.csv',
      batchRequirements: [
        'Include one row per snippet execution case.',
        'Provide the expected final content or acceptance rule.',
        'Keep optional fields empty when not used.',
      ],
      historySummaryLabel: 'Snippet evaluation batch',
    }
  }

  return {
    judgeModels,
    builtinMetrics,
    workflowOptions,
    fieldOptions: workflowFields,
    templateFileName: 'workflow-evaluation-template.csv',
    batchRequirements: [
      'Include one row per workflow test case.',
      'Provide both user input and expected answer when available.',
      'Keep boolean columns as true or false.',
    ],
    historySummaryLabel: 'Workflow evaluation batch',
  }
}
