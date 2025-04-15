import {
  getConnectedEdges,
  getIncomers,
  getOutgoers,
} from 'reactflow'
import { v4 as uuid4 } from 'uuid'
import {
  groupBy,
  isEqual,
  uniqBy,
} from 'lodash-es'
import type {
  Edge,
  Node,
} from '../types'
import {
  BlockEnum,
} from '../types'
import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'

export const canRunBySingle = (nodeType: BlockEnum) => {
  return nodeType === BlockEnum.LLM
    || nodeType === BlockEnum.KnowledgeRetrieval
    || nodeType === BlockEnum.Code
    || nodeType === BlockEnum.TemplateTransform
    || nodeType === BlockEnum.QuestionClassifier
    || nodeType === BlockEnum.HttpRequest
    || nodeType === BlockEnum.Tool
    || nodeType === BlockEnum.ParameterExtractor
    || nodeType === BlockEnum.Iteration
    || nodeType === BlockEnum.Agent
    || nodeType === BlockEnum.DocExtractor
    || nodeType === BlockEnum.Loop
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
    if (sourceNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] || {
        _connectedSourceHandleIds: [...(sourceNode?.data._connectedSourceHandleIds || [])],
        _connectedTargetHandleIds: [...(sourceNode?.data._connectedTargetHandleIds || [])],
      }
    }

    const targetNode = nodes.find(node => node.id === edge.target)!
    if (targetNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] || {
        _connectedSourceHandleIds: [...(targetNode?.data._connectedSourceHandleIds || [])],
        _connectedTargetHandleIds: [...(targetNode?.data._connectedTargetHandleIds || [])],
      }
    }

    if (sourceNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.findIndex((handleId: string) => handleId === edge.sourceHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.splice(index, 1)
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.push(edge.sourceHandle || 'source')
    }

    if (targetNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.findIndex((handleId: string) => handleId === edge.targetHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.splice(index, 1)
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.push(edge.targetHandle || 'target')
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

export const getValidTreeNodes = (nodes: Node[], edges: Edge[]) => {
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)

  if (!startNode) {
    return {
      validNodes: [],
      maxDepth: 0,
    }
  }

  const list: Node[] = [startNode]
  let maxDepth = 1

  const traverse = (root: Node, depth: number) => {
    if (depth > maxDepth)
      maxDepth = depth

    const outgoers = getOutgoers(root, nodes, edges)

    if (outgoers.length) {
      outgoers.forEach((outgoer) => {
        list.push(outgoer)

        if (outgoer.data.type === BlockEnum.Iteration)
          list.push(...nodes.filter(node => node.parentId === outgoer.id))
        if (outgoer.data.type === BlockEnum.Loop)
          list.push(...nodes.filter(node => node.parentId === outgoer.id))

        traverse(outgoer, depth + 1)
      })
    }
    else {
      list.push(root)

      if (root.data.type === BlockEnum.Iteration)
        list.push(...nodes.filter(node => node.parentId === root.id))
      if (root.data.type === BlockEnum.Loop)
        list.push(...nodes.filter(node => node.parentId === root.id))
    }
  }

  traverse(startNode, maxDepth)

  return {
    validNodes: uniqBy(list, 'id'),
    maxDepth,
  }
}

export const changeNodesAndEdgesId = (nodes: Node[], edges: Edge[]) => {
  const idMap = nodes.reduce((acc, node) => {
    acc[node.id] = uuid4()

    return acc
  }, {} as Record<string, string>)

  const newNodes = nodes.map((node) => {
    return {
      ...node,
      id: idMap[node.id],
    }
  })

  const newEdges = edges.map((edge) => {
    return {
      ...edge,
      source: idMap[edge.source],
      target: idMap[edge.target],
    }
  })

  return [newNodes, newEdges] as [Node[], Edge[]]
}

type ParallelInfoItem = {
  parallelNodeId: string
  depth: number
  isBranch?: boolean
}
type NodeParallelInfo = {
  parallelNodeId: string
  edgeHandleId: string
  depth: number
}
type NodeHandle = {
  node: Node
  handle: string
}
type NodeStreamInfo = {
  upstreamNodes: Set<string>
  downstreamEdges: Set<string>
}
export const getParallelInfo = (nodes: Node[], edges: Edge[], parentNodeId?: string) => {
  let startNode

  if (parentNodeId) {
    const parentNode = nodes.find(node => node.id === parentNodeId)
    if (!parentNode)
      throw new Error('Parent node not found')

    startNode = nodes.find(node => node.id === (parentNode.data as (IterationNodeType | LoopNodeType)).start_node_id)
  }
  else {
    startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  }
  if (!startNode)
    throw new Error('Start node not found')

  const parallelList = [] as ParallelInfoItem[]
  const nextNodeHandles = [{ node: startNode, handle: 'source' }]
  let hasAbnormalEdges = false

  const traverse = (firstNodeHandle: NodeHandle) => {
    const nodeEdgesSet = {} as Record<string, Set<string>>
    const totalEdgesSet = new Set<string>()
    const nextHandles = [firstNodeHandle]
    const streamInfo = {} as Record<string, NodeStreamInfo>
    const parallelListItem = {
      parallelNodeId: '',
      depth: 0,
    } as ParallelInfoItem
    const nodeParallelInfoMap = {} as Record<string, NodeParallelInfo>
    nodeParallelInfoMap[firstNodeHandle.node.id] = {
      parallelNodeId: '',
      edgeHandleId: '',
      depth: 0,
    }

    while (nextHandles.length) {
      const currentNodeHandle = nextHandles.shift()!
      const { node: currentNode, handle: currentHandle = 'source' } = currentNodeHandle
      const currentNodeHandleKey = currentNode.id
      const connectedEdges = edges.filter(edge => edge.source === currentNode.id && edge.sourceHandle === currentHandle)
      const connectedEdgesLength = connectedEdges.length
      const outgoers = nodes.filter(node => connectedEdges.some(edge => edge.target === node.id))
      const incomers = getIncomers(currentNode, nodes, edges)

      if (!streamInfo[currentNodeHandleKey]) {
        streamInfo[currentNodeHandleKey] = {
          upstreamNodes: new Set<string>(),
          downstreamEdges: new Set<string>(),
        }
      }

      if (nodeEdgesSet[currentNodeHandleKey]?.size > 0 && incomers.length > 1) {
        const newSet = new Set<string>()
        for (const item of totalEdgesSet) {
          if (!streamInfo[currentNodeHandleKey].downstreamEdges.has(item))
            newSet.add(item)
        }
        if (isEqual(nodeEdgesSet[currentNodeHandleKey], newSet)) {
          parallelListItem.depth = nodeParallelInfoMap[currentNode.id].depth
          nextNodeHandles.push({ node: currentNode, handle: currentHandle })
          break
        }
      }

      if (nodeParallelInfoMap[currentNode.id].depth > parallelListItem.depth)
        parallelListItem.depth = nodeParallelInfoMap[currentNode.id].depth

      outgoers.forEach((outgoer) => {
        const outgoerConnectedEdges = getConnectedEdges([outgoer], edges).filter(edge => edge.source === outgoer.id)
        const sourceEdgesGroup = groupBy(outgoerConnectedEdges, 'sourceHandle')
        const incomers = getIncomers(outgoer, nodes, edges)

        if (outgoers.length > 1 && incomers.length > 1)
          hasAbnormalEdges = true

        Object.keys(sourceEdgesGroup).forEach((sourceHandle) => {
          nextHandles.push({ node: outgoer, handle: sourceHandle })
        })
        if (!outgoerConnectedEdges.length)
          nextHandles.push({ node: outgoer, handle: 'source' })

        const outgoerKey = outgoer.id
        if (!nodeEdgesSet[outgoerKey])
          nodeEdgesSet[outgoerKey] = new Set<string>()

        if (nodeEdgesSet[currentNodeHandleKey]) {
          for (const item of nodeEdgesSet[currentNodeHandleKey])
            nodeEdgesSet[outgoerKey].add(item)
        }

        if (!streamInfo[outgoerKey]) {
          streamInfo[outgoerKey] = {
            upstreamNodes: new Set<string>(),
            downstreamEdges: new Set<string>(),
          }
        }

        if (!nodeParallelInfoMap[outgoer.id]) {
          nodeParallelInfoMap[outgoer.id] = {
            ...nodeParallelInfoMap[currentNode.id],
          }
        }

        if (connectedEdgesLength > 1) {
          const edge = connectedEdges.find(edge => edge.target === outgoer.id)!
          nodeEdgesSet[outgoerKey].add(edge.id)
          totalEdgesSet.add(edge.id)

          streamInfo[currentNodeHandleKey].downstreamEdges.add(edge.id)
          streamInfo[outgoerKey].upstreamNodes.add(currentNodeHandleKey)

          for (const item of streamInfo[currentNodeHandleKey].upstreamNodes)
            streamInfo[item].downstreamEdges.add(edge.id)

          if (!parallelListItem.parallelNodeId)
            parallelListItem.parallelNodeId = currentNode.id

          const prevDepth = nodeParallelInfoMap[currentNode.id].depth + 1
          const currentDepth = nodeParallelInfoMap[outgoer.id].depth

          nodeParallelInfoMap[outgoer.id].depth = Math.max(prevDepth, currentDepth)
        }
        else {
          for (const item of streamInfo[currentNodeHandleKey].upstreamNodes)
            streamInfo[outgoerKey].upstreamNodes.add(item)

          nodeParallelInfoMap[outgoer.id].depth = nodeParallelInfoMap[currentNode.id].depth
        }
      })
    }

    parallelList.push(parallelListItem)
  }

  while (nextNodeHandles.length) {
    const nodeHandle = nextNodeHandles.shift()!
    traverse(nodeHandle)
  }

  return {
    parallelList,
    hasAbnormalEdges,
  }
}

export const hasErrorHandleNode = (nodeType?: BlockEnum) => {
  return nodeType === BlockEnum.LLM || nodeType === BlockEnum.Tool || nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.Code
}
