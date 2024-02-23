import { useCallback } from 'react'
import produce from 'immer'
import type { EdgeMouseHandler } from 'reactflow'
import { useStoreApi } from 'reactflow'
import type { SelectedNode } from './types'
import { useStore } from './store'

export const useWorkflow = () => {
  const store = useStoreApi()
  const setSelectedNode = useStore(state => state.setSelectedNode)

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

  return {
    handleEnterEdge,
    handleLeaveEdge,
    handleSelectNode,
  }
}
