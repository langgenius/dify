import type { Edge, Node, OnNodeAdd } from '../../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { consoleQuery } from '@/service/client'
import { useIncrementSnippetUseCountMutation } from '@/service/use-snippets'
import { CUSTOM_EDGE, ITERATION_CHILDREN_Z_INDEX, LOOP_CHILDREN_Z_INDEX, NODE_WIDTH_X_OFFSET, X_OFFSET } from '../../constants'
import { useNodesSyncDraft, useWorkflowHistory, WorkflowHistoryEvent } from '../../hooks'
import { BlockEnum } from '../../types'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../../utils'

type SnippetInsertPayload = Parameters<OnNodeAdd>[1]

const getSnippetGraph = (graph: Record<string, unknown> | undefined) => {
  if (!graph)
    return { nodes: [] as Node[], edges: [] as Edge[] }

  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes as Node[] : [],
    edges: Array.isArray(graph.edges) ? graph.edges as Edge[] : [],
  }
}

const getRootNodes = (nodes: Node[]) => {
  const rootNodes = nodes.filter(node => !node.parentId)
  return rootNodes.length ? rootNodes : nodes
}

const getSnippetBoundaryNodes = (nodes: Node[], edges: Edge[]) => {
  const rootNodes = getRootNodes(nodes)
  const rootNodeIds = new Set(rootNodes.map(node => node.id))
  const incomingNodeIds = new Set<string>()
  const outgoingNodeIds = new Set<string>()

  edges.forEach((edge) => {
    if (!rootNodeIds.has(edge.source) || !rootNodeIds.has(edge.target))
      return

    outgoingNodeIds.add(edge.source)
    incomingNodeIds.add(edge.target)
  })

  return {
    entryNodes: rootNodes.filter(node => !incomingNodeIds.has(node.id)),
    exitNodes: rootNodes.filter(node => !outgoingNodeIds.has(node.id)),
  }
}

const canConnectToTarget = (node: Node) => {
  return node.data.type !== BlockEnum.DataSource
}

const canConnectFromSource = (node: Node) => {
  return node.data.type !== BlockEnum.IfElse
    && node.data.type !== BlockEnum.QuestionClassifier
    && node.data.type !== BlockEnum.HumanInput
    && node.data.type !== BlockEnum.LoopEnd
}

const getInsertAnchor = (
  currentNodes: Node[],
  insertPayload?: SnippetInsertPayload,
) => {
  const prevNode = insertPayload?.prevNodeId
    ? currentNodes.find(node => node.id === insertPayload.prevNodeId)
    : undefined
  const nextNode = insertPayload?.nextNodeId
    ? currentNodes.find(node => node.id === insertPayload.nextNodeId)
    : undefined

  if (nextNode) {
    return {
      x: nextNode.position.x,
      y: nextNode.position.y,
    }
  }

  if (prevNode) {
    return {
      x: prevNode.position.x + (prevNode.width ?? 0) + X_OFFSET,
      y: prevNode.position.y,
    }
  }
}

const remapSnippetGraph = (
  currentNodes: Node[],
  snippetNodes: Node[],
  snippetEdges: Edge[],
  insertPayload?: SnippetInsertPayload,
) => {
  const existingIds = new Set(currentNodes.map(node => node.id))
  const idMapping = new Map<string, string>()
  const rootNodes = snippetNodes.filter(node => !node.parentId)
  const minRootX = rootNodes.length ? Math.min(...rootNodes.map(node => node.position.x)) : 0
  const minRootY = rootNodes.length ? Math.min(...rootNodes.map(node => node.position.y)) : 0
  const currentMaxX = currentNodes.length
    ? Math.max(...currentNodes.map((node) => {
        const nodeX = node.positionAbsolute?.x ?? node.position.x
        return nodeX + (node.width ?? 0)
      }))
    : 0
  const currentMinY = currentNodes.length
    ? Math.min(...currentNodes.map(node => node.positionAbsolute?.y ?? node.position.y))
    : 0
  const insertAnchor = getInsertAnchor(currentNodes, insertPayload)
  const offsetX = (insertAnchor?.x ?? (currentNodes.length ? currentMaxX + 80 : 80)) - minRootX
  const offsetY = (insertAnchor?.y ?? (currentNodes.length ? currentMinY : 80)) - minRootY

  snippetNodes.forEach((node, index) => {
    let nextId = `${node.id}-${Date.now()}-${index}`
    while (existingIds.has(nextId))
      nextId = `${nextId}-1`
    existingIds.add(nextId)
    idMapping.set(node.id, nextId)
  })

  const nodes = snippetNodes.map((node) => {
    const nextParentId = node.parentId ? idMapping.get(node.parentId) : undefined
    const isRootNode = !node.parentId

    return {
      ...node,
      id: idMapping.get(node.id)!,
      parentId: nextParentId,
      position: isRootNode
        ? {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY,
          }
        : node.position,
      positionAbsolute: node.positionAbsolute
        ? (isRootNode
            ? {
                x: node.positionAbsolute.x + offsetX,
                y: node.positionAbsolute.y + offsetY,
              }
            : node.positionAbsolute)
        : undefined,
      selected: true,
      data: {
        ...node.data,
        selected: true,
        _children: node.data._children?.map(child => ({
          ...child,
          nodeId: idMapping.get(child.nodeId) ?? child.nodeId,
        })),
      },
    }
  })

  const edges = snippetEdges.map(edge => ({
    ...edge,
    id: `${idMapping.get(edge.source)}-${edge.sourceHandle}-${idMapping.get(edge.target)}-${edge.targetHandle}`,
    source: idMapping.get(edge.source)!,
    target: idMapping.get(edge.target)!,
    selected: false,
    data: edge.data
      ? {
          ...edge.data,
          _connectedNodeIsSelected: true,
        }
      : edge.data,
  }))

  return { nodes, edges }
}

const getCurrentEdge = (edges: Edge[], insertPayload?: SnippetInsertPayload) => {
  if (!insertPayload?.prevNodeId || !insertPayload.nextNodeId)
    return undefined

  return edges.find(edge =>
    edge.source === insertPayload.prevNodeId
    && edge.target === insertPayload.nextNodeId
    && (edge.sourceHandle || 'source') === (insertPayload.prevNodeSourceHandle || 'source')
    && (edge.targetHandle || 'target') === (insertPayload.nextNodeTargetHandle || 'target'),
  )
}

const getParentNode = (nodes: Node[], insertPayload?: SnippetInsertPayload) => {
  const prevNode = insertPayload?.prevNodeId
    ? nodes.find(node => node.id === insertPayload.prevNodeId)
    : undefined
  const nextNode = insertPayload?.nextNodeId
    ? nodes.find(node => node.id === insertPayload.nextNodeId)
    : undefined
  const parentId = prevNode?.parentId ?? nextNode?.parentId

  return parentId ? nodes.find(node => node.id === parentId) : undefined
}

const createBoundaryEdges = ({
  currentNodes,
  insertPayload,
  entryNodes,
  exitNodes,
}: {
  currentNodes: Node[]
  insertPayload?: SnippetInsertPayload
  entryNodes: Node[]
  exitNodes: Node[]
}) => {
  const prevNode = insertPayload?.prevNodeId
    ? currentNodes.find(node => node.id === insertPayload.prevNodeId)
    : undefined
  const nextNode = insertPayload?.nextNodeId
    ? currentNodes.find(node => node.id === insertPayload.nextNodeId)
    : undefined
  const parentNode = getParentNode(currentNodes, insertPayload)
  const isInIteration = parentNode?.data.type === BlockEnum.Iteration
  const isInLoop = parentNode?.data.type === BlockEnum.Loop
  const zIndex = parentNode
    ? isInIteration ? ITERATION_CHILDREN_Z_INDEX : LOOP_CHILDREN_Z_INDEX
    : 0
  const incomingEdges: Edge[] = []
  const outgoingEdges: Edge[] = []

  if (prevNode) {
    incomingEdges.push(...entryNodes.filter(canConnectToTarget).map((entryNode) => {
      const sourceHandle = insertPayload?.prevNodeSourceHandle || 'source'
      const targetHandle = 'target'

      return {
        id: `${prevNode.id}-${sourceHandle}-${entryNode.id}-${targetHandle}`,
        type: CUSTOM_EDGE,
        source: prevNode.id,
        sourceHandle,
        target: entryNode.id,
        targetHandle,
        data: {
          sourceType: prevNode.data.type,
          targetType: entryNode.data.type,
          isInIteration,
          isInLoop,
          iteration_id: isInIteration ? parentNode?.id : undefined,
          loop_id: isInLoop ? parentNode?.id : undefined,
          _connectedNodeIsSelected: true,
        },
        zIndex,
      } as Edge
    }))
  }

  if (nextNode) {
    outgoingEdges.push(...exitNodes.filter(canConnectFromSource).map((exitNode) => {
      const sourceHandle = 'source'
      const targetHandle = insertPayload?.nextNodeTargetHandle || 'target'

      return {
        id: `${exitNode.id}-${sourceHandle}-${nextNode.id}-${targetHandle}`,
        type: CUSTOM_EDGE,
        source: exitNode.id,
        sourceHandle,
        target: nextNode.id,
        targetHandle,
        data: {
          sourceType: exitNode.data.type,
          targetType: nextNode.data.type,
          isInIteration,
          isInLoop,
          iteration_id: isInIteration ? parentNode?.id : undefined,
          loop_id: isInLoop ? parentNode?.id : undefined,
          _connectedNodeIsSelected: true,
        },
        zIndex,
      } as Edge
    }))
  }

  return [...incomingEdges, ...outgoingEdges]
}

export const useInsertSnippet = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { mutate: incrementSnippetUseCount } = useIncrementSnippetUseCountMutation()

  const handleInsertSnippet = useCallback(async (snippetId: string, insertPayload?: SnippetInsertPayload) => {
    try {
      const workflow = await queryClient.fetchQuery(consoleQuery.snippets.publishedWorkflow.queryOptions({
        input: {
          params: { snippetId },
        },
      }))
      const { nodes: snippetNodes, edges: snippetEdges } = getSnippetGraph(workflow.graph)

      if (!snippetNodes.length)
        return

      const { getNodes, setNodes, edges, setEdges } = store.getState()
      const currentNodes = getNodes()
      const remappedGraph = remapSnippetGraph(currentNodes, snippetNodes, snippetEdges, insertPayload)
      const parentNode = getParentNode(currentNodes, insertPayload)
      const rootNodeIds = new Set(getRootNodes(remappedGraph.nodes).map(node => node.id))
      const rootSnippetNodes = remappedGraph.nodes.filter(node => rootNodeIds.has(node.id))
      const currentEdge = getCurrentEdge(edges, insertPayload)
      const { entryNodes, exitNodes } = getSnippetBoundaryNodes(remappedGraph.nodes, remappedGraph.edges)
      const boundaryEdges = createBoundaryEdges({
        currentNodes,
        insertPayload,
        entryNodes,
        exitNodes,
      })
      const changes = [
        ...(currentEdge ? [{ type: 'remove', edge: currentEdge }] : []),
        ...boundaryEdges.map(edge => ({ type: 'add', edge })),
      ]
      const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        changes,
        [...currentNodes, ...remappedGraph.nodes],
      )
      const firstEntryNode = entryNodes.find(canConnectToTarget) ?? entryNodes[0]
      const clearedNodes = currentNodes.map(node => ({
        ...node,
        selected: false,
        position: insertPayload?.nextNodeId && node.id === insertPayload.nextNodeId
          ? {
              ...node.position,
              x: node.position.x + NODE_WIDTH_X_OFFSET,
            }
          : node.position,
        data: {
          ...node.data,
          selected: false,
          ...(nodesConnectedSourceOrTargetHandleIdsMap[node.id] ?? {}),
          _children: parentNode?.id === node.id
            ? [
                ...(node.data._children ?? []),
                ...rootSnippetNodes.map(rootNode => ({
                  nodeId: rootNode.id,
                  nodeType: rootNode.data.type,
                })),
              ]
            : node.data._children,
          start_node_id: node.id === parentNode?.id
            && node.data.start_node_id === insertPayload?.nextNodeId
            && firstEntryNode
            ? firstEntryNode.id
            : node.data.start_node_id,
          startNodeType: node.id === parentNode?.id
            && node.data.start_node_id === insertPayload?.nextNodeId
            && firstEntryNode
            ? firstEntryNode.data.type
            : node.data.startNodeType,
        },
      }))
      const insertedNodes = remappedGraph.nodes.map((node) => {
        const shouldMoveIntoParent = !!parentNode && rootNodeIds.has(node.id)
        const isInIteration = parentNode?.data.type === BlockEnum.Iteration
        const isInLoop = parentNode?.data.type === BlockEnum.Loop

        return {
          ...node,
          parentId: shouldMoveIntoParent ? parentNode.id : node.parentId,
          extent: shouldMoveIntoParent ? parentNode.extent : node.extent,
          zIndex: shouldMoveIntoParent
            ? isInIteration ? ITERATION_CHILDREN_Z_INDEX : LOOP_CHILDREN_Z_INDEX
            : node.zIndex,
          data: {
            ...node.data,
            ...(nodesConnectedSourceOrTargetHandleIdsMap[node.id] ?? {}),
            isInIteration: shouldMoveIntoParent ? isInIteration : node.data.isInIteration,
            isInLoop: shouldMoveIntoParent ? isInLoop : node.data.isInLoop,
            iteration_id: shouldMoveIntoParent && isInIteration ? parentNode.id : node.data.iteration_id,
            loop_id: shouldMoveIntoParent && isInLoop ? parentNode.id : node.data.loop_id,
          },
        }
      })

      setNodes([...clearedNodes, ...insertedNodes])
      setEdges([
        ...edges
          .filter(edge => edge.id !== currentEdge?.id)
          .map(edge => ({
            ...edge,
            data: {
              ...edge.data,
              _connectedNodeIsSelected: false,
            },
          })),
        ...remappedGraph.edges,
        ...boundaryEdges,
      ])
      saveStateToHistory(WorkflowHistoryEvent.NodePaste, {
        nodeId: remappedGraph.nodes[0]?.id,
      })
      handleSyncWorkflowDraft()
      incrementSnippetUseCount({
        params: { snippetId },
      })
      return true
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('createFailed', { ns: 'snippet' }))
      return false
    }
  }, [handleSyncWorkflowDraft, incrementSnippetUseCount, queryClient, saveStateToHistory, store, t])

  return {
    handleInsertSnippet,
  }
}
