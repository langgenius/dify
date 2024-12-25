import format from '.'
import { simpleIterationData } from './data'

describe('iteration', () => {
  test('result should have no nodes in iteration node', () => {
    expect(format(simpleIterationData.in as any).find(item => !!(item as any).execution_metadata?.iteration_id)).toBeUndefined()
  })
  test('iteration should put nodes in details', () => {
    expect(format(simpleIterationData.in as any)).toEqual(simpleIterationData.expect)
  })
})
