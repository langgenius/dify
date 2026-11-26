import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChecklistBeforePublish } from '@/app/components/workflow/hooks/use-checklist'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

type UseSnippetPublishOptions = {
  snippetId: string
}

export const useSnippetPublish = ({ snippetId }: UseSnippetPublishOptions) => {
  const { t } = useTranslation(['snippet'])
  const workflowStore = useWorkflowStore()
  const { mutateAsync: publishSnippet, isPending: isPublishing } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.publish.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { handleCheckBeforePublish } = useChecklistBeforePublish()

  const handlePublish = useCallback(async () => {
    try {
      const canPublish = await handleCheckBeforePublish()
      if (!canPublish) return

      const publishedWorkflow = await publishSnippet({
        params: { snippet_id: snippetId },
        body: {},
      })
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
      toast.success(t(($) => $.publishSuccess))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.publishFailed))
      return false
    }
  }, [handleCheckBeforePublish, publishSnippet, snippetId, t, workflowStore])

  return {
    handlePublish,
    isPublishing,
  }
}
