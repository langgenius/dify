import type { NodeTracing } from '@/types/workflow'
import { noop } from 'es-toolkit/function'
import format, { addChildrenToIterationNode } from '..'
import graphToLogStruct from '../../graph-to-log-struct'

describe('iteration', () => {
  const list = graphToLogStruct('start -> (iteration, iterationNode, plainNode1 -> plainNode2)')
  const result = format(list as NodeTracing[], noop)
  it('result should have no nodes in iteration node', () => {
    expect(result.find(item => !!item.execution_metadata?.iteration_id)).toBeUndefined()
  })

  it('should place the first child of a new iteration at a new record when its index is missing', () => {
    const parent = { node_id: 'iter1', node_type: 'iteration', execution_metadata: {} } as unknown as NodeTracing
    const child0 = { node_id: 'code', execution_metadata: { iteration_id: 'iter1', iteration_index: 0 } } as unknown as NodeTracing
    const streaming = { node_id: 'code', execution_metadata: { iteration_id: 'iter1' } } as unknown as NodeTracing

    const result = addChildrenToIterationNode(parent, [child0, streaming])
    expect(result.details![0]).toEqual([child0])
    expect(result.details![1]).toEqual([streaming])
  })

  it('should keep missing iteration_index items in the current record when the node has not restarted', () => {
    const parent = {
      node_id: 'iter1',
      node_type: 'iteration',
      execution_metadata: {
        iteration_duration_map: { 0: 1.2, 1: 0.4 },
      },
    } as unknown as NodeTracing
    const child0 = { node_id: 'code', execution_metadata: { iteration_id: 'iter1', iteration_index: 0 } } as unknown as NodeTracing
    const child1 = { node_id: 'code', execution_metadata: { iteration_id: 'iter1', iteration_index: 1 } } as unknown as NodeTracing
    const streaming = { node_id: 'tool', execution_metadata: { iteration_id: 'iter1' } } as unknown as NodeTracing

    const result = addChildrenToIterationNode(parent, [child0, child1, streaming])
    expect(result.details![0]).toEqual([child0])
    expect(result.details![1]).toEqual([child1, streaming])
  })
})
