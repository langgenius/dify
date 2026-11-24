import type { Snippet as SnippetContract } from '@/types/snippet'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChecklistBeforePublish } from '@/app/components/workflow/hooks/use-checklist'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { workflowVersionHistoryKey } from '@/service/workflow-queries'

type UseSnippetPublishOptions = {
  snippetId: string
}

export const useSnippetPublish = ({ snippetId }: UseSnippetPublishOptions) => {
  const { t } = useTranslation(['snippet'])
  const workflowStore = useWorkflowStore()
  const queryClient = useQueryClient()
  const { mutateAsync: publishSnippet, isPending: isPublishing } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.publish.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const resetWorkflowVersionHistory = useCallback(
    () =>
      queryClient.resetQueries({
        queryKey: workflowVersionHistoryKey({ kind: 'snippet', snippetId }),
      }),
    [queryClient, snippetId],
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
      queryClient.setQueryData<SnippetContract | undefined>(
        consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.key({
          type: 'query',
          input: {
            params: { snippet_id: snippetId },
          },
        }),
        (old) => (old ? { ...old, is_published: true } : old),
      )
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
      resetWorkflowVersionHistory()
      toast.success(t(($) => $.publishSuccess))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.publishFailed))
      return false
    }
  }, [
    handleCheckBeforePublish,
    publishSnippet,
    queryClient,
    resetWorkflowVersionHistory,
    snippetId,
    t,
    workflowStore,
  ])

  return {
    handlePublish,
    isPublishing,
  }
}
