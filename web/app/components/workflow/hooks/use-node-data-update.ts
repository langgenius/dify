import type { SyncDraftCallback } from '@/app/components/workflow/hooks-store'
import { produce } from 'immer'
import { useStore as useAtomStore } from 'jotai'
import { useCallback } from 'react'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { editorAppIdAtom } from '../editor-resource/state'
import { useStore } from '../store'
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
  const atomStore = useAtomStore()
  const identity = useStore((state) => state.loroDraft)

  const handleNodeDataUpdate = useCallback(
    ({ id, data, previousData }: NodeDataUpdatePayload) => {
      if (previousData && identity) {
        const appId = atomStore.get(editorAppIdAtom)
        if (!appId || !collaborationManager.isDraftHistoryReady(appId, identity)) return false
        if (collaborationManager.updateDraftNodeData(id, previousData, data)) return true
      }
      const { nodes, setNodes } = collaborativeWorkflow.getState()
      const nodeIndex = nodes.findIndex((node) => node.id === id)
      if (nodeIndex === -1) return false
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft[nodeIndex]!
        currentNode.data = { ...currentNode.data, ...data }
      })
      setNodes(newNodes)
      return true
    },
    [atomStore, collaborativeWorkflow, identity],
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
      if (getNodesReadOnly() || !handleNodeDataUpdate(payload)) return false
      handleSyncWorkflowDraft(options?.sync, options?.notRefreshWhenSyncError, options?.callback)
      return true
    },
    [handleSyncWorkflowDraft, handleNodeDataUpdate, getNodesReadOnly],
  )

  const initializeNodeData = useCallback(
    (payload: Required<NodeDataUpdatePayload>) =>
      collaborationManager.runDraftInitialization(() => handleNodeDataUpdate(payload)),
    [handleNodeDataUpdate],
  )

  return {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
    initializeNodeData,
  }
}
