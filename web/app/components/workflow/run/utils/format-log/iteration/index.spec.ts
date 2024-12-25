import format from '.'
import { simpleIterationData } from './data'

describe('format api data to tracing panel data', () => {
  test('iteration should put nodes in details', () => {
    // console.log(format(simpleIterationData.in as any))
    expect(format(simpleIterationData.in as any)).toEqual(simpleIterationData.output)
  })
})
