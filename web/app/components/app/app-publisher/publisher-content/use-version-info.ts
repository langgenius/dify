import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInvalidateAppWorkflow, useUpdateWorkflow } from '@/service/use-workflow'

type VersionInfoUpdate = {
  id?: string
  title: string
  releaseNotes: string
}

export function useVersionInfo({
  appId,
  publishedWorkflow,
  onClosePublisher,
}: {
  appId?: string
  publishedWorkflow?: WorkflowResponse | null
  onClosePublisher: () => void
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { mutate: updateWorkflow } = useUpdateWorkflow()
  const invalidateAppWorkflow = useInvalidateAppWorkflow()

  function openEditor() {
    if (!publishedWorkflow) return

    onClosePublisher()
    setIsOpen(true)
  }

  function updateVersionInfo(params: VersionInfoUpdate) {
    if (!appId || !params.id) return

    updateWorkflow(
      {
        url: `/apps/${appId}/workflows/${params.id}`,
        title: params.title,
        releaseNotes: params.releaseNotes,
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['versionHistory.action.updateSuccess'], { ns: 'workflow' }))
          invalidateAppWorkflow(appId)
        },
        onError: () => {
          toast.error(t(($) => $['versionHistory.action.updateFailure'], { ns: 'workflow' }))
        },
        onSettled: () => {
          setIsOpen(false)
        },
      },
    )
  }

  return {
    closeEditor: () => setIsOpen(false),
    isOpen,
    openEditor,
    updateVersionInfo,
  }
}
