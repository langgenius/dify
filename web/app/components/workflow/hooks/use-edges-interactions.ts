import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'
import { useStoreApi } from 'reactflow'
import { useStore } from '../store'
import type { Node } from '../types'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

export const useEdgesInteractions = () => {
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data = { ...currentEdge.data, _hovering: true }
    })
    setEdges(newEdges)
  }, [store])

  const handleEdgeLeave = useCallback<EdgeMouseHandler>((_, edge) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data = { ...currentEdge.data, _hovering: false }
    })
    setEdges(newEdges)
  }, [store])

  const handleEdgeDeleteByDeleteBranch = useCallback((nodeId: string, branchId: string) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const currentEdgeIndex = edges.findIndex(edge => edge.source === nodeId && edge.sourceHandle === branchId)

    if (currentEdgeIndex < 0)
      return

    const currentEdge = edges[currentEdgeIndex]
    const newNodes = produce(getNodes(), (draft: Node[]) => {
      const sourceNode = draft.find(node => node.id === currentEdge.source)
      const targetNode = draft.find(node => node.id === currentEdge.target)

      if (sourceNode)
        sourceNode.data._connectedSourceHandleIds = sourceNode.data._connectedSourceHandleIds?.filter(handleId => handleId !== currentEdge.sourceHandle)

      if (targetNode)
        targetNode.data._connectedTargetHandleIds = targetNode.data._connectedTargetHandleIds?.filter(handleId => handleId !== currentEdge.targetHandle)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.splice(currentEdgeIndex, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleEdgeDelete = useCallback(() => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const currentEdgeIndex = edges.findIndex(edge => edge.selected)

    if (currentEdgeIndex < 0)
      return
    const currentEdge = edges[currentEdgeIndex]
    const newNodes = produce(getNodes(), (draft: Node[]) => {
      const sourceNode = draft.find(node => node.id === currentEdge?.source)
      const targetNode = draft.find(node => node.id === currentEdge?.target)

      if (sourceNode)
        sourceNode.data._connectedSourceHandleIds = sourceNode.data._connectedSourceHandleIds?.filter(handleId => handleId !== currentEdge.sourceHandle)

      if (targetNode)
        targetNode.data._connectedTargetHandleIds = targetNode.data._connectedTargetHandleIds?.filter(handleId => handleId !== currentEdge.targetHandle)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.splice(currentEdgeIndex, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleEdgesChange = useCallback<OnEdgesChange>((changes) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      changes.forEach((change) => {
        if (change.type === 'select')
          draft.find(edge => edge.id === change.id)!.selected = change.selected
      })
    })
    setEdges(newEdges)
  }, [store])

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDeleteByDeleteBranch,
    handleEdgeDelete,
    handleEdgesChange,
  }
}
