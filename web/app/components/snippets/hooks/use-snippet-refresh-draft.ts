import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import type { InputVar } from '@/models/pipeline'
import type { SnippetWorkflow } from '@/types/snippet'
import { useCallback } from 'react'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { reportRequestError } from '@/app/query-error-toast'
import { fetchSnippetDraftWorkflow } from '@/service/snippet-queries'
import { useSnippetDraftStore } from '../draft-store'

export const useSnippetRefreshDraft = (snippetId: string) => {
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleRefreshWorkflowDraft = useCallback(
    (onSuccess?: (draftWorkflow: SnippetWorkflow) => void) => {
      const { setDraftUpdatedAt, setIsSyncingWorkflowDraft, setSyncWorkflowDraftHash } =
        workflowStore.getState()

      if (!snippetId) return

      setIsSyncingWorkflowDraft(true)
      fetchSnippetDraftWorkflow(snippetId)
        .then((response) => {
          if (!response) return

          const inputFields = Array.isArray(response.input_fields)
            ? (response.input_fields as InputVar[])
            : []

          handleUpdateWorkflowCanvas({
            ...response.graph,
            nodes: response.graph?.nodes || [],
            edges: response.graph?.edges || [],
            viewport: response.graph?.viewport || { x: 0, y: 0, zoom: 1 },
          } as WorkflowDataUpdater)
          useSnippetDraftStore.setState({
            inputFields,
          })
          setSyncWorkflowDraftHash(response.hash)
          setDraftUpdatedAt(response.updated_at)
          onSuccess?.(response)
        })
        // The canvas keeps its current graph, so the failed reload is reported here.
        .catch(reportRequestError)
        .finally(() => {
          setIsSyncingWorkflowDraft(false)
        })
    },
    [handleUpdateWorkflowCanvas, snippetId, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
