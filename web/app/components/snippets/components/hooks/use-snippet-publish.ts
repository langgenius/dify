import { useKeyPress } from 'ahooks'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/app/components/base/ui/toast'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import { usePublishSnippetWorkflowMutation } from '@/service/use-snippet-workflows'
import { useSnippetDetailStore } from '../../store'

type UseSnippetPublishOptions = {
  snippetId: string
}

export const useSnippetPublish = ({
  snippetId,
}: UseSnippetPublishOptions) => {
  const { t } = useTranslation('snippet')
  const publishSnippetMutation = usePublishSnippetWorkflowMutation(snippetId)
  const {
    isPublishMenuOpen,
    setPublishMenuOpen,
  } = useSnippetDetailStore(useShallow(state => ({
    isPublishMenuOpen: state.isPublishMenuOpen,
    setPublishMenuOpen: state.setPublishMenuOpen,
  })))

  const handlePublish = useCallback(async () => {
    try {
      await publishSnippetMutation.mutateAsync({
        params: { snippetId },
      })
      setPublishMenuOpen(false)
      toast.success(t('publishSuccess'))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('publishFailed'))
    }
  }, [publishSnippetMutation, setPublishMenuOpen, snippetId, t])

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
