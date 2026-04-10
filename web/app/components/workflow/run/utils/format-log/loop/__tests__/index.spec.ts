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

  it('should place the first child of a new loop run at a new record when its index is missing', () => {
    const parent = { node_id: 'loop1', node_type: 'loop', execution_metadata: {} } as unknown as NodeTracing
    const child0 = { node_id: 'code', execution_metadata: { loop_id: 'loop1', loop_index: 0 } } as unknown as NodeTracing
    const streaming = { node_id: 'code', execution_metadata: { loop_id: 'loop1' } } as unknown as NodeTracing

    const result = addChildrenToLoopNode(parent, [child0, streaming])
    expect(result.details![0]).toEqual([child0])
    expect(result.details![1]).toEqual([streaming])
  })

  it('should keep missing loop_index items in the current record when the node has not restarted', () => {
    const parent = {
      node_id: 'loop1',
      node_type: 'loop',
      execution_metadata: {
        loop_duration_map: { 0: 1.2, 1: 0.4 },
      },
    } as unknown as NodeTracing
    const child0 = { node_id: 'code', execution_metadata: { loop_id: 'loop1', loop_index: 0 } } as unknown as NodeTracing
    const child1 = { node_id: 'code', execution_metadata: { loop_id: 'loop1', loop_index: 1 } } as unknown as NodeTracing
    const streaming = { node_id: 'tool', execution_metadata: { loop_id: 'loop1' } } as unknown as NodeTracing

    const result = addChildrenToLoopNode(parent, [child0, child1, streaming])
    expect(result.details![0]).toEqual([child0])
    expect(result.details![1]).toEqual([child1, streaming])
  })

  it('should not jump to the latest loop when an earlier item is missing loop_index', () => {
    const parent = {
      node_id: 'loop1',
      node_type: 'loop',
      execution_metadata: {
        loop_duration_map: { 0: 1.2, 1: 0.4 },
      },
    } as unknown as NodeTracing
    const code0 = { node_id: 'code', execution_metadata: { loop_id: 'loop1', loop_index: 0 } } as unknown as NodeTracing
    const tool = { node_id: 'tool', execution_metadata: { loop_id: 'loop1' } } as unknown as NodeTracing
    const code1 = { node_id: 'code', execution_metadata: { loop_id: 'loop1', loop_index: 1 } } as unknown as NodeTracing

    const result = addChildrenToLoopNode(parent, [code0, tool, code1])
    expect(result.details![0]).toEqual([code0, tool])
    expect(result.details![1]).toEqual([code1])
  })
})
