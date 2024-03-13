import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useStore } from '../store'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

type NodeDataUpdatePayload = {
  id: string
  data: Record<string, any>
}

export const useNodeDataUpdate = () => {
  const store = useStoreApi()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleNodeDataUpdate = useCallback(({ id, data }: NodeDataUpdatePayload) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(node => node.id === id)!

      currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
  }, [store])

  const handleNodeDataUpdateWithSyncDraft = useCallback((payload: NodeDataUpdatePayload) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    handleNodeDataUpdate(payload)
    handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft, handleNodeDataUpdate])

  return {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  }
}
