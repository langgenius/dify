import type { NodeTracing } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import format from '..'
import graphToLogStruct from '../../graph-to-log-struct'

describe('iteration', () => {
  const list = graphToLogStruct('start -> (iteration, iterationNode, plainNode1 -> plainNode2)')
  const result = format(list as NodeTracing[], noop)
  it('result should have no nodes in iteration node', () => {
    expect(result.find(item => !!item.execution_metadata?.iteration_id)).toBeUndefined()
  })
  // test('iteration should put nodes in details', () => {
  //   expect(result).toEqual([
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
