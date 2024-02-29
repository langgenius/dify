import produce from 'immer'
import {
  getConnectedEdges,
  getOutgoers,
} from 'reactflow'
import type {
  Edge,
  Node,
} from './types'

export const nodesLevelOrderTraverse = (
  firstNode: Node,
  nodes: Node[],
  edges: Edge[],
  callback: (n: Node) => void,
) => {
  const queue = [{
    node: firstNode,
  }]

  while (queue.length) {
    const { node } = queue.shift()!
    callback(node)

    const targetBranches = node.data.targetBranches
    if (targetBranches?.length) {
      const targetEdges = getConnectedEdges([node], edges)

      if (targetEdges.length) {
        const sortedTargetEdges = targetEdges
          .filter(edge => edge.source === node.id)
          .sort((a, b) => {
            const aIndex = targetBranches.findIndex(branch => branch.id === a.sourceHandle)
            const bIndex = targetBranches.findIndex(branch => branch.id === b.sourceHandle)

            return aIndex - bIndex
          })

        const outgoers = getOutgoers(node, nodes, sortedTargetEdges)
        queue.push(...outgoers.map((outgoer) => {
          return {
            node: outgoer,
          }
        }))
      }
    }
    else {
      const outgoers = getOutgoers(node, nodes, edges)

      if (outgoers.length === 1) {
        queue.push({
          node: outgoers[0],
        })
      }
    }
  }
}

export const initialNodesAndEdges = (nodes: Node[], edges: Edge[]) => {
  const newNodes = produce(nodes, (draft) => {
    draft.forEach((node) => {
      node.type = 'custom'
    })
  })
  const newEdges = produce(edges, (draft) => {
    draft.forEach((edge) => {
      edge.type = 'custom'
    })
  })

  return [newNodes, newEdges]
}

export type PositionMap = {
  position: {
    x: number
    y: number
  }
  index: {
    x: number
    y: number
  }
}
