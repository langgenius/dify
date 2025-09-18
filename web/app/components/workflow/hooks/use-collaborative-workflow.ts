import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import type { Edge, Node } from '../types'
import { collaborationManager } from '../collaboration/core/collaboration-manager'

export const useCollaborativeWorkflow = () => {
  const store = useStoreApi()
  const { setNodes: collabSetNodes, setEdges: collabSetEdges } = collaborationManager

  const setNodes = useCallback((newNodes: Node[], shouldBroadcast: boolean = true) => {
    const { getNodes, setNodes: reactFlowSetNodes } = store.getState()
    if (shouldBroadcast) {
      const oldNodes = getNodes()
      collabSetNodes(oldNodes, newNodes)
    }
    reactFlowSetNodes(newNodes)
  }, [store, collabSetNodes])

  const setEdges = useCallback((newEdges: Edge[], shouldBroadcast: boolean = true) => {
    const { edges, setEdges: reactFlowSetEdges } = store.getState()
    if (shouldBroadcast)
      collabSetEdges(edges, newEdges)

    reactFlowSetEdges(newEdges)
  }, [store, collabSetEdges])

  const collaborativeStore = useCallback(() => {
    const state = store.getState()
    return {

      nodes: state.getNodes(),
      edges: state.edges,

      setNodes,
      setEdges,

    }
  }, [store, setNodes, setEdges])

  return {
    getState: collaborativeStore,
    setNodes,
    setEdges,
  }
}
