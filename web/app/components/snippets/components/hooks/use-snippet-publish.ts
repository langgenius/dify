import type { Snippet as SnippetContract } from '@/types/snippet'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useKeyPress } from 'ahooks'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChecklistBeforePublish } from '@/app/components/workflow/hooks/use-checklist'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import { consoleQuery } from '@/service/client'
import { usePublishSnippetWorkflowMutation } from '@/service/use-snippet-workflows'
import { useSnippetDetailStore } from '../../store'

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
  const { handleCheckBeforePublish } = useChecklistBeforePublish()
  const {
    isPublishMenuOpen,
    setPublishMenuOpen,
  } = useSnippetDetailStore(useShallow(state => ({
    isPublishMenuOpen: state.isPublishMenuOpen,
    setPublishMenuOpen: state.setPublishMenuOpen,
  })))

  const handlePublish = useCallback(async () => {
    try {
      const canPublish = await handleCheckBeforePublish()
      if (!canPublish)
        return

      const publishedWorkflow = await publishSnippetMutation.mutateAsync({
        params: { snippetId },
      })
      queryClient.setQueryData<SnippetContract | undefined>(
        consoleQuery.snippets.detail.queryKey({
          input: {
            params: { snippetId },
          },
        }),
        old => old ? { ...old, is_published: true } : old,
      )
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
      setPublishMenuOpen(false)
      toast.success(t('publishSuccess'))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('publishFailed'))
    }
  }, [handleCheckBeforePublish, publishSnippetMutation, queryClient, setPublishMenuOpen, snippetId, t, workflowStore])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (event) => {
    if (publishSnippetMutation.isPending)
      return

    event.preventDefault()
    void handlePublish()
  }, { exactMatch: true, useCapture: true })

  return {
    handlePublish,
    isPublishMenuOpen,
    isPublishing: publishSnippetMutation.isPending,
    setPublishMenuOpen,
  }
}
