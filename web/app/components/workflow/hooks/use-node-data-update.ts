import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '../store'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

type NodeDataUpdatePayload = {
  id: string
  data: Record<string, any>
}

export const useNodeDataUpdate = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
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
    const { runningStatus } = workflowStore.getState()

    if (runningStatus)
      return

    handleNodeDataUpdate(payload)
    handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft, handleNodeDataUpdate, workflowStore])

  return {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  }
}
