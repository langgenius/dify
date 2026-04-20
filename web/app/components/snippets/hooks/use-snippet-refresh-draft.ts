import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import type { SnippetInputField } from '@/models/snippet'
import type { SnippetWorkflow } from '@/types/snippet'
import { useCallback } from 'react'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleClient } from '@/service/client'
import { useSnippetDetailStore } from '../store'

export const useSnippetRefreshDraft = (snippetId: string) => {
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback((onSuccess?: (draftWorkflow: SnippetWorkflow) => void) => {
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
      const inputFields = Array.isArray(response.input_fields)
        ? response.input_fields as SnippetInputField[]
        : []

      handleUpdateWorkflowCanvas({
        ...response.graph,
        nodes: response.graph?.nodes || [],
        edges: response.graph?.edges || [],
        viewport: response.graph?.viewport || { x: 0, y: 0, zoom: 1 },
      } as WorkflowDataUpdater)
      useSnippetDetailStore.setState({
        fields: inputFields,
      })
      setSyncWorkflowDraftHash(response.hash)
      setDraftUpdatedAt(response.updated_at)
      onSuccess?.(response)
    }).finally(() => {
      setIsSyncingWorkflowDraft(false)
    })
  }, [handleUpdateWorkflowCanvas, snippetId, workflowStore])

  return {
    handleRefreshWorkflowDraft,
  }
}
