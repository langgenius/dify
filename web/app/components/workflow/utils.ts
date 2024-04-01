import {
  Position,
  getConnectedEdges,
} from 'reactflow'
import dagre from 'dagre'
import { cloneDeep } from 'lodash-es'
import type {
  Edge,
  Node,
} from './types'
import { BlockEnum } from './types'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from './constants'
import type { QuestionClassifierNodeType } from './nodes/question-classifier/types'

export const initialNodes = (nodes: Node[], edges: Edge[]) => {
  const firstNode = nodes[0]

  if (!firstNode?.position) {
    nodes.forEach((node, index) => {
      node.position = {
        x: START_INITIAL_POSITION.x + index * NODE_WIDTH_X_OFFSET,
        y: START_INITIAL_POSITION.y,
      }
    })
  }
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

export const initialEdges = (edges: Edge[], nodes: Node[]) => {
  const nodesMap = nodes.reduce((acc, node) => {
    acc[node.id] = node

    return acc
  }, {} as Record<string, Node>)
  return edges.map((edge) => {
    edge.type = 'custom'

    if (!edge.data?.sourceType)
      edge.data = { ...edge.data, sourceType: nodesMap[edge.source].data.type! } as any

    if (!edge.data?.targetType)
      edge.data = { ...edge.data, targetType: nodesMap[edge.target].data.type! } as any

    return edge
  })
}

const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))
export const getLayoutByDagre = (originNodes: Node[], originEdges: Edge[]) => {
  const nodes = cloneDeep(originNodes)
  const edges = cloneDeep(originEdges)
  dagreGraph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 64,
    ranksep: 40,
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
    const sourceNode = nodes.find(node => node.id === edge.source)!
    nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] || {
      _connectedSourceHandleIds: sourceNode?.data._connectedSourceHandleIds || [],
      _connectedTargetHandleIds: sourceNode?.data._connectedTargetHandleIds || [],
    }
    const targetNode = nodes.find(node => node.id === edge.target)!
    nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] || {
      _connectedSourceHandleIds: sourceNode?.data._connectedSourceHandleIds || [],
      _connectedTargetHandleIds: targetNode?.data._connectedTargetHandleIds || [],
    }

    if (sourceNode) {
      if (type === 'remove')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.filter((handleId: string) => handleId !== edge.sourceHandle)

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.push(edge.sourceHandle || 'source')
    }

    if (targetNode) {
      if (type === 'remove')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.filter((handleId: string) => handleId !== edge.targetHandle)

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.push(edge.targetHandle || 'target')
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

export const generateNewNode = ({ data, position, id }: Pick<Node, 'data' | 'position'> & { id?: string }) => {
  return {
    id: id || `${Date.now()}`,
    type: 'custom',
    data,
    position,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  } as Node
}
