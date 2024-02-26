import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  NodeMouseHandler,
} from 'reactflow'
import {
  getConnectedEdges,
  useStoreApi,
} from 'reactflow'
import type {
  SelectedNode,
} from './types'
import { useStore } from './store'

export const useWorkflow = () => {
  const store = useStoreApi()
  const setSelectedNode = useStore(state => state.setSelectedNode)

  const handleEnterNode = useCallback<NodeMouseHandler>((_, node) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(n => n.id === node.id)
      if (currentNode)
        currentNode.data = { ...currentNode.data, hovering: true }
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const connectedEdges = getConnectedEdges([node], edges)

      connectedEdges.forEach((edge) => {
        const currentEdge = draft.find(e => e.id === edge.id)
        if (currentEdge)
          currentEdge.data = { ...currentEdge.data, connectedNodeIsHovering: true }
      })
    })
    setEdges(newEdges)
  }, [store])
  const handleLeaveNode = useCallback<NodeMouseHandler>((_, node) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(n => n.id === node.id)
      if (currentNode)
        currentNode.data = { ...currentNode.data, hovering: false }
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const connectedEdges = getConnectedEdges([node], edges)

      connectedEdges.forEach((edge) => {
        const currentEdge = draft.find(e => e.id === edge.id)
        if (currentEdge)
          currentEdge.data = { ...currentEdge.data, connectedNodeIsHovering: false }
      })
    })
    setEdges(newEdges)
  }, [store])
  const handleEnterEdge = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)
      if (currentEdge)
        currentEdge.data = { ...currentEdge.data, hovering: true }
    })
    setEdges(newEdges)
  }, [store])
  const handleLeaveEdge = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)
      if (currentEdge)
        currentEdge.data = { ...currentEdge.data, hovering: false }
    })
    setEdges(newEdges)
  }, [store])
  const handleSelectNode = useCallback((selectNode: SelectedNode, cancelSelection?: boolean) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    if (cancelSelection) {
      setSelectedNode(null)
      const newNodes = produce(getNodes(), (draft) => {
        const currentNode = draft.find(n => n.id === selectNode.id)

        if (currentNode)
          currentNode.data = { ...currentNode.data, selected: false }
      })
      setNodes(newNodes)
    }
    else {
      setSelectedNode(selectNode)
      const newNodes = produce(getNodes(), (draft) => {
        const currentNode = draft.find(n => n.id === selectNode.id)

        if (currentNode)
          currentNode.data = { ...currentNode.data, selected: true }
      })
      setNodes(newNodes)
    }
  }, [setSelectedNode, store])
  const handleUpdateNodeData = useCallback(({ id, data }: SelectedNode) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(n => n.id === id)
      if (currentNode)
        currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
    setSelectedNode({ id, data })
  }, [store, setSelectedNode])

  return {
    handleEnterNode,
    handleLeaveNode,
    handleEnterEdge,
    handleLeaveEdge,
    handleSelectNode,
    handleUpdateNodeData,
  }
}
