import formatToTracingNodeList from './format-to-tracing-node-list'
import { simpleIterationData } from './spec-test-data'

describe('format api data to tracing panel data', () => {
  test('iteration should put nodes in details', () => {
    expect(formatToTracingNodeList(simpleIterationData.in)).toEqual(simpleIterationData.out)
  })
})
