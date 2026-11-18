import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import { produce } from 'immer'
import { useCallback } from 'react'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'

type NodeDataUpdatePayload = {
  id: string
  previousData?: Record<string, unknown>
  data: Record<string, unknown>
}

export const useNodeDataUpdate = () => {
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleNodeDataUpdate = useCallback(
    ({ id, data, previousData }: NodeDataUpdatePayload) => {
      if (previousData && collaborationManager.updateDraftNodeData(id, previousData, data)) return
      const { nodes, setNodes } = collaborativeWorkflow.getState()
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === id)!

        if (currentNode) currentNode.data = { ...currentNode.data, ...data }
      })
      setNodes(newNodes)
    },
    [collaborativeWorkflow],
  )

  const handleNodeDataUpdateWithSyncDraft = useCallback(
    (
      payload: NodeDataUpdatePayload,
      options?: {
        sync?: boolean
        notRefreshWhenSyncError?: boolean
        callback?: SyncDraftCallback
      },
    ) => {
      if (getNodesReadOnly()) return

      handleNodeDataUpdate(payload)
      handleSyncWorkflowDraft(options?.sync, options?.notRefreshWhenSyncError, options?.callback)
    },
    [handleSyncWorkflowDraft, handleNodeDataUpdate, getNodesReadOnly],
  )

  return {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  }
}
