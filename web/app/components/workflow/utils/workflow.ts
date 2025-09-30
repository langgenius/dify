import {
  getOutgoers,
} from 'reactflow'
import { v4 as uuid4 } from 'uuid'
import {
  uniqBy,
} from 'lodash-es'
import type {
  Edge,
  Node,
} from '../types'
import {
  BlockEnum,
} from '../types'

export const canRunBySingle = (nodeType: BlockEnum, isChildNode: boolean) => {
  // child node means in iteration or loop. Set value to iteration(or loop) may cause variable not exit problem in backend.
  if(isChildNode && nodeType === BlockEnum.Assigner)
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

/**
 * Validate that multiple entry nodes in the same connected graph don't point to different END nodes
 */
export const validateEndNodeConvergence = (nodes: Node[], edges: Edge[]) => {
  // Find all entry nodes (Start and Trigger nodes)
  const entryNodes = nodes.filter(node =>
    node.data.type === BlockEnum.Start
    || node.data.type === BlockEnum.TriggerSchedule
    || node.data.type === BlockEnum.TriggerWebhook
    || node.data.type === BlockEnum.TriggerPlugin,
  )

  // If there are 0 or 1 entry nodes, no convergence issue
  if (entryNodes.length <= 1) {
    return {
      isValid: true,
      conflictingEntryNodes: [],
      reachableEndNodes: [],
    }
  }

  // Find connected components using DFS
  const visited = new Set<string>()
  const connectedComponents: Node[][] = []

  const dfs = (nodeId: string, component: Node[]) => {
    if (visited.has(nodeId)) return

    visited.add(nodeId)
    const node = nodes.find(n => n.id === nodeId)
    if (node)
      component.push(node)

    // Find all connected edges (both incoming and outgoing)
    const connectedEdges = edges.filter(edge =>
      edge.source === nodeId || edge.target === nodeId,
    )

    connectedEdges.forEach((edge) => {
      const nextNodeId = edge.source === nodeId ? edge.target : edge.source
      if (!visited.has(nextNodeId))
        dfs(nextNodeId, component)
    })
  }

  // Find all connected components
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      const component: Node[] = []
      dfs(node.id, component)
      if (component.length > 0)
        connectedComponents.push(component)
    }
  })

  // Check each connected component
  for (const component of connectedComponents) {
    // Find entry nodes in this component
    const componentEntryNodes = component.filter(node =>
      node.data.type === BlockEnum.Start
      || node.data.type === BlockEnum.TriggerSchedule
      || node.data.type === BlockEnum.TriggerWebhook
      || node.data.type === BlockEnum.TriggerPlugin,
    )

    // If this component has multiple entry nodes, check their reachable END nodes
    if (componentEntryNodes.length > 1) {
      const allReachableEndNodes = new Set<string>()

      // For each entry node, find all reachable END nodes using DFS
      componentEntryNodes.forEach((entryNode) => {
        const reachableEndNodes = findReachableEndNodes(entryNode.id, nodes, edges)
        reachableEndNodes.forEach(endNodeId => allReachableEndNodes.add(endNodeId))
      })

      // If there are multiple different reachable END nodes, it's invalid
      if (allReachableEndNodes.size > 1) {
        return {
          isValid: false,
          conflictingEntryNodes: componentEntryNodes,
          reachableEndNodes: Array.from(allReachableEndNodes),
        }
      }
    }
  }

  return {
    isValid: true,
    conflictingEntryNodes: [],
    reachableEndNodes: [],
  }
}

/**
 * Find all reachable END nodes from a given starting node using DFS
 */
function findReachableEndNodes(startNodeId: string, nodes: Node[], edges: Edge[]): Set<string> {
  const reachableEndNodes = new Set<string>()
  const visited = new Set<string>()

  const dfs = (nodeId: string) => {
    if (visited.has(nodeId)) return

    visited.add(nodeId)
    const node = nodes.find(n => n.id === nodeId)

    if (node?.data.type === BlockEnum.End) {
      reachableEndNodes.add(nodeId)
      return
    }

    // Find outgoing edges
    const outgoingEdges = edges.filter(edge => edge.source === nodeId)
    outgoingEdges.forEach((edge) => {
      dfs(edge.target)
    })
  }

  dfs(startNodeId)
  return reachableEndNodes
}
