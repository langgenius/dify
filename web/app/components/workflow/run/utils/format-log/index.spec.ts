import formatToTracingNodeList from '.'
import { simpleIterationData } from './iteration/data'
import { simpleRetryData } from './retry/data'

describe('format api data to tracing panel data', () => {
  test('integration', () => {
    expect(formatToTracingNodeList(simpleIterationData.in.reverse() as any)).toEqual(simpleIterationData.expect)
    expect(formatToTracingNodeList(simpleRetryData.in.reverse() as any)).toEqual(simpleRetryData.expect)
  })
})
