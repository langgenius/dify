import type { NodeTracing } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import format, { addChildrenToLoopNode } from '..'
import graphToLogStruct from '../../graph-to-log-struct'

describe('loop', () => {
  const list = graphToLogStruct('start -> (loop, loopNode, plainNode1 -> plainNode2)')
  const [startNode, loopNode, ...loops] = list
  const result = format(list as NodeTracing[], noop)
  it('result should have no nodes in loop node', () => {
    expect(result.find(item => !!item.execution_metadata?.loop_id)).toBeUndefined()
  })
  it('loop should put nodes in details', () => {
    expect(result).toEqual([
      startNode,
      {
        ...loopNode,
        details: [
          [loops[0], loops[1]],
        ],
      },
    ])
  })

  it('should place items with missing loop_index at the latest record', () => {
    const parent = { node_id: 'loop1', node_type: 'loop', execution_metadata: {} } as unknown as NodeTracing
    const child0 = { node_id: 'a', execution_metadata: { loop_id: 'loop1', loop_index: 0 } } as unknown as NodeTracing
    const child1 = { node_id: 'b', execution_metadata: { loop_id: 'loop1', loop_index: 1 } } as unknown as NodeTracing
    const streaming = { node_id: 'c', execution_metadata: { loop_id: 'loop1' } } as unknown as NodeTracing

    const result = addChildrenToLoopNode(parent, [child0, child1, streaming])
    expect(result.details![0]).toEqual([child0])
    expect(result.details![1]).toEqual([child1, streaming])
  })
})
