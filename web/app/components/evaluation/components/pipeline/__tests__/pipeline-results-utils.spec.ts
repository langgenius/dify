import type { EvaluationRunItemResponse } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import {
  formatExpectedOutput,
  getIsItemPassed,
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
