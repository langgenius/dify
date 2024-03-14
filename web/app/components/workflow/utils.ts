import {
  Position,
  getConnectedEdges,
  getOutgoers,
} from 'reactflow'
import dagre from 'dagre'
import type {
  Edge,
  Node,
} from './types'
import { BlockEnum } from './types'
import type { QuestionClassifierNodeType } from './nodes/question-classifier/types'

export const nodesLevelOrderTraverse = (
  firstNode: Node,
  nodes: Node[],
  edges: Edge[],
  callback: (n: any) => void,
) => {
  const queue = [{
    node: firstNode,
    depth: 0,
    breath: 0,
  }]

  let currenDepth = 0
  let currentBreath = 0
  while (queue.length) {
    const { node, depth, breath } = queue.shift()!

    if (currenDepth !== depth) {
      currenDepth = depth
      currentBreath = 0
    }

    callback({ node, depth, breath })

    const targetBranches = node.data._targetBranches
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

        queue.push(...outgoers.map((outgoer, index) => {
          return {
            node: outgoer,
            depth: depth + 1,
            breath: currentBreath + index,
          }
        }))

        currentBreath += outgoers.length
      }
      else {
        currentBreath += 1
      }
    }
    else {
      const outgoers = getOutgoers(node, nodes, edges)

      if (outgoers.length === 1) {
        queue.push({
          node: outgoers[0],
          depth: depth + 1,
          breath: 0,
        })
      }

      currentBreath += 1
    }
  }
}

export const initialNodes = (nodes: Node[], edges: Edge[]) => {
  return nodes.map((node) => {
    node.type = 'custom'

    const connectedEdges = getConnectedEdges([node], edges)
    node.data._connectedSourceHandleIds = connectedEdges.filter(edge => edge.source === node.id).map(edge => edge.sourceHandle || 'source')
    node.data._connectedTargetHandleIds = connectedEdges.filter(edge => edge.target === node.id).map(edge => edge.targetHandle || 'target')

    if (node.data.type === BlockEnum.IfElse) {
      node.data._targetBranches = [
        {
          id: 'true',
          name: 'IS TRUE',
        },
        {
          id: 'false',
          name: 'IS FALSE',
        },
      ]
    }

    if (node.data.type === BlockEnum.QuestionClassifier) {
      node.data._targetBranches = (node.data as QuestionClassifierNodeType).classes.map((topic) => {
        return topic
      })
    }

    return node
  })
}

export const initialEdges = (edges: Edge[]) => {
  return edges.map((edge) => {
    edge.type = 'custom'

    return edge
  })
}

export type PositionMap = {
  index: {
    x: number
    y: number
  }
}

export const getNodesPositionMap = (nodes: Node[], edges: Edge[]) => {
  const startNode = nodes.find((node: Node) => node.data.type === BlockEnum.Start)
  const positionMap: Record<string, PositionMap> = {}

  if (startNode) {
    nodesLevelOrderTraverse(startNode, nodes, edges, ({ node, depth, breath }) => {
      positionMap[node.id] = {
        index: {
          x: depth,
          y: breath,
        },
      }
    })
  }

  return positionMap
}

export const getLayoutByDagre = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 64,
    ranksep: 64,
  })
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: node.width, height: node.height })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  return dagreGraph
}

export const canRunBySingle = (nodeType: BlockEnum) => {
  return nodeType === BlockEnum.LLM
    || nodeType === BlockEnum.KnowledgeRetrieval
    || nodeType === BlockEnum.Code
    || nodeType === BlockEnum.TemplateTransform
    || nodeType === BlockEnum.QuestionClassifier
    || nodeType === BlockEnum.HttpRequest
    || nodeType === BlockEnum.Tool
}

type ConnectedSourceOrTargetNodesChange = {
  type: string
  edge: Edge
}[]
export const getNodesConnectedSourceOrTargetHandleIdsMap = (changes: ConnectedSourceOrTargetNodesChange, nodes: Node[]) => {
  const nodesConnectedSourceOrTargetHandleIdsMap = {} as Record<string, any>

  changes.forEach((change) => {
    const {
      edge,
      type,
    } = change
    const sourceNode = nodes.find(node => node.id === edge.source)
    const sourceNodeConnectedSourceHandleIds = sourceNode?.data._connectedSourceHandleIds || []
    const targetNode = nodes.find(node => node.id === edge.target)
    const targetNodeConnectedTargetHandleIds = targetNode?.data._connectedTargetHandleIds || []

    if (sourceNode) {
      const newSourceNodeConnectedSourceHandleIds = type === 'remove'
        ? sourceNodeConnectedSourceHandleIds.filter(handleId => handleId !== edge.sourceHandle)
        : sourceNodeConnectedSourceHandleIds.concat(edge.sourceHandle || 'source')
      if (!nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]) {
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] = {
          _connectedSourceHandleIds: newSourceNodeConnectedSourceHandleIds,
        }
      }
      else {
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds = newSourceNodeConnectedSourceHandleIds
      }
    }
    if (targetNode) {
      const newTargetNodeConnectedTargetHandleIds = type === 'remove'
        ? targetNodeConnectedTargetHandleIds.filter(handleId => handleId !== edge.targetHandle)
        : targetNodeConnectedTargetHandleIds.concat(edge.targetHandle || 'target')
      if (!nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]) {
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] = {
          _connectedTargetHandleIds: newTargetNodeConnectedTargetHandleIds,
        }
      }
      else {
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds = newTargetNodeConnectedTargetHandleIds
      }
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

export const generateNewNode = ({ data, position }: Pick<Node, 'data' | 'position'>) => {
  return {
    id: `${Date.now()}`,
    type: 'custom',
    data,
    position,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  } as Node
}
