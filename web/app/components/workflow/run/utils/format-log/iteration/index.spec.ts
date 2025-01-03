import format from '.'
import graphToLogStruct from '../graph-to-log-struct'

describe('iteration', () => {
  const list = graphToLogStruct('start -> (iteration, 1, [2, 3])')
  const [startNode, iterationNode, ...iterations] = graphToLogStruct('start -> (iteration, 1, [2, 3])')
  const result = format(list as any, () => { })
  test('result should have no nodes in iteration node', () => {
    expect((result as any).find((item: any) => !!item.execution_metadata?.iteration_id)).toBeUndefined()
  })
  test('iteration should put nodes in details', () => {
    expect(result as any).toEqual([
      startNode,
      {
        ...iterationNode,
        details: [
          [iterations[0]],
          [iterations[1]],
        ],
      },
    ])
  })
})
