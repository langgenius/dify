import {
  getOutgoers,
} from 'reactflow'
import { cloneDeep } from 'lodash-es'
import type {
  Edge,
  Node,
} from './types'
import { BlockEnum } from './types'

export const initialNodesPosition = (oldNodes: Node[], edges: Edge[]) => {
  const nodes = cloneDeep(oldNodes)
  const start = nodes.find(node => node.data.type === BlockEnum.Start)!

  start.data.hidden = false
  start.position.x = 0
  start.position.y = 0
  start.data.position = {
    x: 0,
    y: 0,
  }
  const queue = [start]

  let depth = 0
  let breadth = 0
  let baseHeight = 0
  while (queue.length) {
    const node = queue.shift()!

    if (node.data.position?.x !== depth) {
      breadth = 0
      baseHeight = 0
    }

    depth = node.data.position?.x || 0

    const outgoers = getOutgoers(node, nodes, edges).sort((a, b) => (a.data.sortIndexInBranches || 0) - (b.data.sortIndexInBranches || 0))

    if (outgoers.length) {
      queue.push(...outgoers.map((outgoer) => {
        outgoer.data.hidden = false
        outgoer.data.position = {
          x: depth + 1,
          y: breadth,
        }
        outgoer.position.x = (depth + 1) * (220 + 64)
        outgoer.position.y = baseHeight
        baseHeight += ((outgoer.height || 0) + 39)
        breadth += 1
        return outgoer
      }))
    }
  }

  return nodes
}
