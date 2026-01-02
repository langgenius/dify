import { noop } from 'es-toolkit/function'
import format from '.'
import graphToLogStruct from '../graph-to-log-struct'

describe('iteration', () => {
  const list = graphToLogStruct('start -> (iteration, iterationNode, plainNode1 -> plainNode2)')
  // const [startNode, iterationNode, ...iterations] = list
  const result = format(list as any, noop)
  it('result should have no nodes in iteration node', () => {
    expect((result as any).find((item: any) => !!item.execution_metadata?.iteration_id)).toBeUndefined()
  })
  // test('iteration should put nodes in details', () => {
  //   expect(result as any).toEqual([
  //     startNode,
  //     {
  //       ...iterationNode,
  //       details: [
  //         [iterations[0], iterations[1]],
  //       ],
  //     },
  //   ])
  // })
})
