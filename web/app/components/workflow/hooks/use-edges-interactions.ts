import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  OnEdgesChange,
} from 'reactflow'
import { useStoreApi } from 'reactflow'
import { useStore } from '../store'
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
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const index = draft.findIndex(edge => edge.source === nodeId && edge.sourceHandle === branchId)

      if (index > -1)
        draft.splice(index, 1)
    })
    setEdges(newEdges)
    handleSyncWorkflowDraft()
  }, [store, handleSyncWorkflowDraft])

  const handleEdgeDelete = useCallback(() => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const index = draft.findIndex(edge => edge.selected)

      if (index > -1)
        draft.splice(index, 1)
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
