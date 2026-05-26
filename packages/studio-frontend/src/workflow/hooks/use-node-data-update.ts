import type { SyncCallback } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'

type NodeDataUpdatePayload = {
  id: string
  data: Record<string, unknown>
}

export const useNodeDataUpdate = () => {
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleNodeDataUpdate = useCallback(({ id, data }: NodeDataUpdatePayload) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === id)!

      if (currentNode)
        currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
  }, [collaborativeWorkflow])

  const handleNodeDataUpdateWithSyncDraft = useCallback((
    payload: NodeDataUpdatePayload,
    options?: {
      sync?: boolean
      notRefreshWhenSyncError?: boolean
      callback?: SyncCallback
    },
  ) => {
    if (getNodesReadOnly())
      return

    handleNodeDataUpdate(payload)
    handleSyncWorkflowDraft(options?.sync, options?.notRefreshWhenSyncError, options?.callback)
  }, [handleSyncWorkflowDraft, handleNodeDataUpdate, getNodesReadOnly])

  return {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  }
}
