import type { Edge, Node } from '../types'
import { useRefWithInit } from '@langgenius/dify-ui/use-ref-with-init'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { isExternalAgentWorkflowPreviewData } from '@/features/agent-v2/external-agent/workflow-preview/types'
import { collaborationManager } from '../collaboration/core/collaboration-manager'

const sanitizeNodeForBroadcast = (node: Node): Node => {
  if (!node.data) return node

  if (!Object.prototype.hasOwnProperty.call(node.data, 'selected')) return node

  const sanitizedData = { ...node.data }
  delete (sanitizedData as Record<string, unknown>).selected

  return {
    ...node,
    data: sanitizedData,
  }
}

const sanitizeEdgeForBroadcast = (edge: Edge): Edge => {
  if (!edge.data) return edge

  if (!Object.prototype.hasOwnProperty.call(edge.data, '_connectedNodeIsSelected')) return edge

  const sanitizedData = { ...edge.data }
  delete (sanitizedData as Record<string, unknown>)._connectedNodeIsSelected

  return {
    ...edge,
    data: sanitizedData,
  }
}

export const useCollaborativeWorkflow = () => {
  const store = useStoreApi()
  const previewNodeIds = useRefWithInit(() => new Set<string>()).current
  const { setNodes: collabSetNodes, setEdges: collabSetEdges } = collaborationManager

  const setNodes = useCallback(
    (
      newNodes: Node[],
      shouldBroadcast: boolean = true,
      source = 'use-collaborative-workflow:setNodes',
    ) => {
      const { getNodes, setNodes: reactFlowSetNodes } = store.getState()
      const oldNodes = getNodes()
      for (const node of [...oldNodes, ...newNodes]) {
        if (isExternalAgentWorkflowPreviewData(node.data)) previewNodeIds.add(node.id)
      }
      if (shouldBroadcast) {
        if (!collaborationManager.canApplyLocalGraphMutation()) return

        collabSetNodes(
          oldNodes
            .filter((node) => !isExternalAgentWorkflowPreviewData(node.data))
            .map(sanitizeNodeForBroadcast),
          newNodes
            .filter((node) => !isExternalAgentWorkflowPreviewData(node.data))
            .map(sanitizeNodeForBroadcast),
          source,
        )
      }
      reactFlowSetNodes(newNodes)
    },
    [store, collabSetNodes, previewNodeIds],
  )

  const setEdges = useCallback(
    (newEdges: Edge[], shouldBroadcast: boolean = true) => {
      const { edges, getNodes, setEdges: reactFlowSetEdges } = store.getState()
      for (const node of getNodes()) {
        if (isExternalAgentWorkflowPreviewData(node.data)) previewNodeIds.add(node.id)
      }
      if (shouldBroadcast) {
        if (!collaborationManager.canApplyLocalGraphMutation()) return

        const canBroadcastEdge = (edge: Edge) =>
          !previewNodeIds.has(edge.source) && !previewNodeIds.has(edge.target)
        collabSetEdges(
          edges.filter(canBroadcastEdge).map(sanitizeEdgeForBroadcast),
          newEdges.filter(canBroadcastEdge).map(sanitizeEdgeForBroadcast),
        )
      }

      reactFlowSetEdges(newEdges)
    },
    [store, collabSetEdges, previewNodeIds],
  )

  const collaborativeStore = useCallback(() => {
    const state = store.getState()
    return {
      nodes: state.getNodes(),
      edges: state.edges,

      setNodes,
      setEdges,
    }
  }, [store, setNodes, setEdges])

  return useMemo(
    () => ({
      getState: collaborativeStore,
      setNodes,
      setEdges,
    }),
    [collaborativeStore, setEdges, setNodes],
  )
}
