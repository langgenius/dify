import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
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
  const { t } = useTranslation(['workflowHistory'])
  const [isOpen, setIsOpen] = useState(false)
  const { mutateAsync: updateWorkflow } = useUpdateWorkflow()
  const invalidateAppWorkflow = useInvalidateAppWorkflow()

  function openEditor() {
    if (!publishedWorkflow) return

    onClosePublisher()
    setIsOpen(true)
  }

  async function updateVersionInfo(params: VersionInfoUpdate) {
    if (!appId || !params.id) return

    try {
      await updateWorkflow({
        resource: { kind: 'app', appId },
        versionId: params.id,
        title: params.title,
        releaseNotes: params.releaseNotes,
      })
      toast.success(t(($) => $['versionHistory.action.updateSuccess'], { ns: 'workflowHistory' }))
      invalidateAppWorkflow(appId)
    } catch {
      toast.error(t(($) => $['versionHistory.action.updateFailure'], { ns: 'workflowHistory' }))
    } finally {
      setIsOpen(false)
    }
  }

  return {
    closeEditor: () => setIsOpen(false),
    isOpen,
    openEditor,
    updateVersionInfo,
  }
}
