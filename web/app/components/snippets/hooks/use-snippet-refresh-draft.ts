import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleClient } from '@/service/client'

export const useSnippetRefreshDraft = (snippetId: string) => {
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      setDraftUpdatedAt,
      setIsSyncingWorkflowDraft,
      setSyncWorkflowDraftHash,
    } = workflowStore.getState()

    if (!snippetId)
      return

    setIsSyncingWorkflowDraft(true)
    consoleClient.snippets.draftWorkflow({
      params: { snippetId },
    }).then((response) => {
      handleUpdateWorkflowCanvas({
        ...response.graph,
        nodes: response.graph?.nodes || [],
        edges: response.graph?.edges || [],
        viewport: response.graph?.viewport || { x: 0, y: 0, zoom: 1 },
      } as WorkflowDataUpdater)
      setSyncWorkflowDraftHash(response.hash)
      setDraftUpdatedAt(response.updated_at)
    }).finally(() => {
      setIsSyncingWorkflowDraft(false)
    })
  }, [handleUpdateWorkflowCanvas, snippetId, workflowStore])

  return {
    handleRefreshWorkflowDraft,
  }
}
