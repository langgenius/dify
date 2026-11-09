import type { EvaluationRunItemResponse } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import { buildStateFromEvaluationConfig } from '../../../store-utils'
import {
  formatExpectedOutput,
  getIsItemPassed,
  getMetricColumns,
  getMetricValue,
  toPlainTextPreview,
} from '../pipeline-results-utils'

const createItem = (overrides: Partial<EvaluationRunItemResponse>): EvaluationRunItemResponse => ({
  id: 'item-1',
  item_index: 0,
  overall_score: 0.2,
  ...overrides,
})

describe('knowledge evaluation result status', () => {
  it('uses the saved combined judgment rather than a metric threshold', () => {
    const item = createItem({
      judgment: {
        passed: true,
        logical_operator: 'or',
        condition_results: [
          { variable_selector: ['dataset-1', 'context-precision'], passed: false },
          { variable_selector: ['dataset-1', 'context-recall'], passed: true },
        ],
      },
    })

    expect(getIsItemPassed(item)).toBe(true)
  })

  it('falls back to the score when no judgment conditions were configured', () => {
    const item = createItem({ judgment: { passed: false, condition_results: [] } })

    expect(getIsItemPassed(item)).toBe(true)
  })
})

describe('result cell values', () => {
  it('shows the expected value instead of the node-keyed object', () => {
    expect(formatExpectedOutput({ LLM: 'The capital of France is Paris.' })).toBe(
      'The capital of France is Paris.',
    )
    expect(formatExpectedOutput({ LLM: 'Paris', Answer: 'France' })).toBe(
      'LLM: Paris\nAnswer: France',
    )
    expect(formatExpectedOutput('plain text')).toBe('plain text')
    expect(formatExpectedOutput('{"LLM": "Water boils at 100 degrees Celsius."}')).toBe(
      'Water boils at 100 degrees Celsius.',
    )
    expect(formatExpectedOutput('{not json')).toBe('{not json')
  })

  it('lists agent success criteria as text', () => {
    expect(
      formatExpectedOutput('{"success_criteria": ["States 59 USD per month", "Is polite"]}'),
    ).toBe('States 59 USD per month\nIs polite')
    expect(
      formatExpectedOutput({
        LLM: 'Paris',
        'Agent : success_criteria': ['Names Paris', 'Is brief'],
      }),
    ).toBe('LLM: Paris\nAgent : success_criteria: Names Paris; Is brief')
  })

  it('previews Markdown model output as plain text', () => {
    expect(toPlainTextPreview('The capital of France is **Paris**.')).toBe(
      'The capital of France is Paris.',
    )
    expect(toPlainTextPreview('Shakespeare wrote *Romeo and Juliet*, likely')).toBe(
      'Shakespeare wrote Romeo and Juliet, likely',
    )
    expect(toPlainTextPreview('# Title\nSee [docs](https://example.com) and `code`')).toBe(
      'Title\nSee docs and code',
    )
  })
})

describe('result metric columns', () => {
  const nodeInfo = { node_id: 'llm', title: 'General Answer', type: 'llm' }

  it('lists only metrics the run produced, labelled from the current config', () => {
    // Answer Relevancy was added to the config after this run.
    const resource = buildStateFromEvaluationConfig('apps', 'app-1', {
      evaluation_framework: 'ragas',
      default_metrics: [
        { metric: 'answer_correctness', node_info_list: [nodeInfo] },
        { metric: 'answer_relevancy', node_info_list: [nodeInfo] },
      ],
    })
    const items = [
      createItem({ metrics: [{ name: 'answer_correctness', value: 0.9 }] }),
      createItem({ id: 'item-2', metrics: [{ name: 'answer_correctness', value: 0.5 }] }),
    ]

    expect(getMetricColumns(resource, items)).toEqual([
      { id: 'answer_correctness', metricName: 'answer_correctness', label: 'Answer Correctness' },
    ])
  })

  it('names a metric missing from the config after its key', () => {
    const resource = buildStateFromEvaluationConfig('apps', 'app-1', {
      evaluation_framework: 'ragas',
      default_metrics: [],
    })

    expect(
      getMetricColumns(resource, [createItem({ metrics: [{ name: 'tool_selection', value: 1 }] })]),
    ).toEqual([{ id: 'tool_selection', metricName: 'tool_selection', label: 'Tool Selection' }])
  })

  it('splits a metric scored on several nodes into one column per node', () => {
    const resource = buildStateFromEvaluationConfig('apps', 'app-1', {
      evaluation_framework: 'ragas',
      default_metrics: [],
    })
    const classic = { node_id: 'kr', title: 'Classic Knowledge', type: 'knowledge-retrieval' }
    const agentKnowledge = {
      node_id: 'akr',
      title: 'Agent Knowledge',
      type: 'knowledge-retrieval-v2',
    }
    const item = createItem({
      metrics: [
        { name: 'context_precision', value: 0.4, node_info: classic },
        { name: 'context_precision', value: 0.9, node_info: agentKnowledge },
        { name: 'answer_correctness', value: 1, node_info: nodeInfo },
      ],
    })

    const columns = getMetricColumns(resource, [item])

    expect(columns.map(({ label, nodeLabel }) => [label, nodeLabel])).toEqual([
      ['Context Precision', 'Classic Knowledge'],
      ['Context Precision', 'Agent Knowledge'],
      ['Answer Correctness', undefined],
    ])
    expect(columns.map((column) => getMetricValue(item.metrics ?? [], column))).toEqual([
      0.4, 0.9, 1,
    ])
  })
})
