import type {
  Node,
} from '@/app/components/workflow/types'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { preprocessNodesAndEdges } from './workflow-init'

describe('preprocessNodesAndEdges', () => {
  it('process nodes without iteration node or loop node should return origin nodes and edges.', () => {
    const nodes = [
      {
        data: {
          type: BlockEnum.Code,
        },
      },
    ]

    const result = preprocessNodesAndEdges(nodes as Node[], [])
    expect(result).toEqual({
      nodes,
      edges: [],
    })
  })

  it('process nodes with iteration node should return nodes with iteration start node', () => {
    const nodes = [
      {
        id: 'iteration',
        data: {
          type: BlockEnum.Iteration,
        },
      },
    ]

    const result = preprocessNodesAndEdges(nodes as Node[], [])
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            type: BlockEnum.IterationStart,
          }),
        }),
      ]),
    )
  })

  it('process nodes with iteration node start should return origin', () => {
    const nodes = [
      {
        data: {
          type: BlockEnum.Iteration,
          start_node_id: 'iterationStart',
        },
      },
      {
        id: 'iterationStart',
        type: CUSTOM_ITERATION_START_NODE,
        data: {
          type: BlockEnum.IterationStart,
        },
      },
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    expect(result).toEqual({
      nodes,
      edges: [],
    })
  })
})
