import type {
  Edge,
  Node,
} from '../types'
import {
  uniqBy,
} from 'lodash-es'
import {
  getOutgoers,
} from 'reactflow'
import { v4 as uuid4 } from 'uuid'
import {
  BlockEnum,
} from '../types'

export const canRunBySingle = (nodeType: BlockEnum, isChildNode: boolean) => {
  // child node means in iteration or loop. Set value to iteration(or loop) may cause variable not exit problem in backend.
  if (isChildNode && nodeType === BlockEnum.Assigner)
    return false
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
    || nodeType === BlockEnum.Start
    || nodeType === BlockEnum.IfElse
    || nodeType === BlockEnum.VariableAggregator
    || nodeType === BlockEnum.Assigner
    || nodeType === BlockEnum.DataSource
    || nodeType === BlockEnum.TriggerSchedule
    || nodeType === BlockEnum.TriggerWebhook
    || nodeType === BlockEnum.TriggerPlugin
}

export const isSupportCustomRunForm = (nodeType: BlockEnum) => {
  return nodeType === BlockEnum.DataSource
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
  // Find all start nodes (Start and Trigger nodes)
  const startNodes = nodes.filter(node =>
    node.data.type === BlockEnum.Start
    || node.data.type === BlockEnum.TriggerSchedule
    || node.data.type === BlockEnum.TriggerWebhook
    || node.data.type === BlockEnum.TriggerPlugin,
  )

  if (startNodes.length === 0) {
    return {
      validNodes: [],
      maxDepth: 0,
    }
  }

  const list: Node[] = []
  let maxDepth = 0

  const traverse = (root: Node, depth: number) => {
    // Add the current node to the list
    list.push(root)

    if (depth > maxDepth)
      maxDepth = depth

    const outgoers = getOutgoers(root, nodes, edges)

    if (outgoers.length) {
      outgoers.forEach((outgoer) => {
        // Only traverse if we haven't processed this node yet (avoid cycles)
        if (!list.find(n => n.id === outgoer.id)) {
          if (outgoer.data.type === BlockEnum.Iteration)
            list.push(...nodes.filter(node => node.parentId === outgoer.id))
          if (outgoer.data.type === BlockEnum.Loop)
            list.push(...nodes.filter(node => node.parentId === outgoer.id))

          traverse(outgoer, depth + 1)
        }
      })
    }
    else {
      // Leaf node - add iteration/loop children if any
      if (root.data.type === BlockEnum.Iteration)
        list.push(...nodes.filter(node => node.parentId === root.id))
      if (root.data.type === BlockEnum.Loop)
        list.push(...nodes.filter(node => node.parentId === root.id))
    }
  }

  // Start traversal from all start nodes
  startNodes.forEach((startNode) => {
    if (!list.find(n => n.id === startNode.id))
      traverse(startNode, 1)
  })

  return {
    validNodes: uniqBy(list, 'id'),
    maxDepth,
  }
}

export const getCommonPredecessorNodeIds = (selectedNodeIds: string[], edges: Edge[]) => {
  const uniqSelectedNodeIds = Array.from(new Set(selectedNodeIds))
  if (uniqSelectedNodeIds.length <= 1)
    return []

  const selectedNodeIdSet = new Set(uniqSelectedNodeIds)
  const predecessorNodeIdsMap = new Map<string, Set<string>>()

  edges.forEach((edge) => {
    if (!selectedNodeIdSet.has(edge.target))
      return

    const predecessors = predecessorNodeIdsMap.get(edge.target) ?? new Set<string>()
    predecessors.add(edge.source)
    predecessorNodeIdsMap.set(edge.target, predecessors)
  })

  let commonPredecessorNodeIds: Set<string> | null = null

  uniqSelectedNodeIds.forEach((nodeId) => {
    const predecessors = predecessorNodeIdsMap.get(nodeId) ?? new Set<string>()

    if (!commonPredecessorNodeIds) {
      commonPredecessorNodeIds = new Set(predecessors)
      return
    }

    Array.from(commonPredecessorNodeIds).forEach((predecessorNodeId) => {
      if (!predecessors.has(predecessorNodeId))
        commonPredecessorNodeIds!.delete(predecessorNodeId)
    })
  })

  return Array.from(commonPredecessorNodeIds ?? []).sort()
}

export type PredecessorHandle = {
  nodeId: string
  handleId: string
}

export const getCommonPredecessorHandles = (targetNodeIds: string[], edges: Edge[]): PredecessorHandle[] => {
  const uniqTargetNodeIds = Array.from(new Set(targetNodeIds))
  if (uniqTargetNodeIds.length === 0)
    return []

  // Get the "direct predecessor handler", which is:
  // - edge.source (predecessor node)
  // - edge.sourceHandle (the specific output handle of the predecessor; defaults to 'source' if not set)
  // Used to handle multi-handle branch scenarios like If-Else / Classifier.
  const targetNodeIdSet = new Set(uniqTargetNodeIds)
  const predecessorHandleMap = new Map<string, Set<string>>() // targetNodeId -> Set<`${source}\0${handleId}`>
  const delimiter = '\u0000'

  edges.forEach((edge) => {
    if (!targetNodeIdSet.has(edge.target))
      return

    const predecessors = predecessorHandleMap.get(edge.target) ?? new Set<string>()
    const handleId = edge.sourceHandle || 'source'
    predecessors.add(`${edge.source}${delimiter}${handleId}`)
    predecessorHandleMap.set(edge.target, predecessors)
  })

  // Intersect predecessor handlers of all targets, keeping only handlers common to all targets.
  let commonKeys: Set<string> | null = null

  uniqTargetNodeIds.forEach((nodeId) => {
    const keys = predecessorHandleMap.get(nodeId) ?? new Set<string>()

    if (!commonKeys) {
      commonKeys = new Set(keys)
      return
    }

    Array.from(commonKeys).forEach((key) => {
      if (!keys.has(key))
        commonKeys!.delete(key)
    })
  })

  return Array.from<string>(commonKeys ?? [])
    .map((key) => {
      const [nodeId, handleId] = key.split(delimiter)
      return { nodeId, handleId }
    })
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.handleId.localeCompare(b.handleId))
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

export const hasErrorHandleNode = (nodeType?: BlockEnum) => {
  return nodeType === BlockEnum.LLM || nodeType === BlockEnum.Tool || nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.Code
}
