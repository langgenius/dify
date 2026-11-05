import type { EvaluationRunItemResponse } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import { getIsItemPassed } from '../pipeline-results-utils'

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
