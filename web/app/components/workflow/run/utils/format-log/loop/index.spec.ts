import format from '.'
import graphToLogStruct from '../graph-to-log-struct'

describe('loop', () => {
  const list = graphToLogStruct('start -> (loop, loopNode, plainNode1 -> plainNode2)')
  const [startNode, loopNode, ...loops] = list
  const result = format(list as any, () => { })
  test('result should have no nodes in loop node', () => {
    expect((result as any).find((item: any) => !!item.execution_metadata?.loop_id)).toBeUndefined()
  })
  test('loop should put nodes in details', () => {
    expect(result as any).toEqual([
      startNode,
      {
        ...loopNode,
        details: [
          [loops[0], loops[1]],
        ],
      },
    ])
  })
})
