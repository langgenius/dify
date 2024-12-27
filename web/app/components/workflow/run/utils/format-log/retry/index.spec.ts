import format from '.'
import { simpleRetryData } from './data'

describe('retry', () => {
  test('should have no retry status nodes', () => {
    expect(format(simpleRetryData.in as any).find(item => (item as any).status === 'retry')).toBeUndefined()
  })
  test('should put retry nodes in retryDetail', () => {
    expect(format(simpleRetryData.in as any)).toEqual(simpleRetryData.expect)
  })
})
