import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { AppModeEnum } from '@/types/app'
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
  appMode,
  publishedWorkflow,
  onClosePublisher,
}: {
  appId?: string
  appMode?: AppModeEnum
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
        appId,
        appMode,
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
