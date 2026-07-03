import type { Snippet as SnippetContract } from '@/types/snippet'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChecklistBeforePublish } from '@/app/components/workflow/hooks/use-checklist'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/client'
import { usePublishSnippetWorkflowMutation } from '@/service/use-snippet-workflows'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'

type UseSnippetPublishOptions = {
  snippetId: string
}

export const useSnippetPublish = ({
  snippetId,
}: UseSnippetPublishOptions) => {
  const { t } = useTranslation('snippet')
  const workflowStore = useWorkflowStore()
  const queryClient = useQueryClient()
  const publishSnippetMutation = usePublishSnippetWorkflowMutation(snippetId)
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const { handleCheckBeforePublish } = useChecklistBeforePublish()

  const handlePublish = useCallback(async () => {
    try {
      const canPublish = await handleCheckBeforePublish()
      if (!canPublish)
        return

      const publishedWorkflow = await publishSnippetMutation.mutateAsync({
        params: { snippetId },
      })
      queryClient.setQueryData<SnippetContract | undefined>(
        consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.key({
          type: 'query',
          input: {
            params: { snippet_id: snippetId },
          },
        }),
        old => old ? { ...old, is_published: true } : old,
      )
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
      resetWorkflowVersionHistory()
      toast.success(t('publishSuccess'))
      return true
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('publishFailed'))
      return false
    }
  }, [handleCheckBeforePublish, publishSnippetMutation, queryClient, resetWorkflowVersionHistory, snippetId, t, workflowStore])

  return {
    handlePublish,
    isPublishing: publishSnippetMutation.isPending,
  }
}
