import format from '.'
import graphToLogStruct from '../graph-to-log-struct'

describe('retry', () => {
  // retry nodeId:1 3 times.
  const steps = graphToLogStruct('start -> (retry, retryNode, 3)')
  const [startNode, retryNode, ...retryDetail] = steps
  const result = format(steps as any)
  test('should have no retry status nodes', () => {
    expect(result.find(item => item.status === 'retry')).toBeUndefined()
  })
  test('should put retry nodes in retryDetail', () => {
    expect(result).toEqual([
      startNode,
      {
        ...retryNode,
        retryDetail,
      },
    ])
  })
})
