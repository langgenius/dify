import { useCallback } from 'react'
import { toggleWorkflowNodeStream } from '@/service/workflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import type { ToolNodeType } from './types'

export const useToolStreamToggle = (appId: string) => {
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getNodesReadOnly } = useNodesReadOnly()

  const handleToggleStream = useCallback(async (nodeId: string, nodeData: ToolNodeType) => {
    if (getNodesReadOnly() || !appId)
      return

    try {
      const res = await toggleWorkflowNodeStream(appId, nodeId) as { result: string; provider_type: string }

      if (res.result === 'success') {
        handleNodeDataUpdate({
          id: nodeId,
          data: {
            ...nodeData,
            provider_type: res.provider_type,
          },
        })

        handleSyncWorkflowDraft()
      }
    }
    catch (error) {
      console.error('Failed to toggle stream mode', error)
    }
  }, [
    appId,
    handleNodeDataUpdate,
    handleSyncWorkflowDraft,
    getNodesReadOnly,
  ])

  return {
    handleToggleStream,
  }
}
