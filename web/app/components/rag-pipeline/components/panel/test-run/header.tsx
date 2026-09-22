import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks/use-workflow-panel-interactions'
import { useWorkflowStore } from '@/app/components/workflow/store'

const Header = () => {
  const workflowStore = useWorkflowStore()

  const { t } = useTranslation()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()

  const handleClose = useCallback(() => {
    const { isPreparingDataSource, setIsPreparingDataSource } = workflowStore.getState()
    if (isPreparingDataSource) setIsPreparingDataSource?.(false)
    handleCancelDebugAndPreviewPanel()
  }, [workflowStore])

  return (
    <div className="flex items-center gap-x-2 pt-4 pr-3 pl-4">
      <div className="grow pr-8 pl-1 system-xl-semibold text-text-primary">
        {t(($) => $['testRun.title'], { ns: 'datasetPipeline' })}
      </div>
      <IconButton
        size="lg"
        aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        className="shrink-0"
        onClick={handleClose}
      >
        <RiCloseLine aria-hidden="true" className="size-4 text-text-tertiary" />
      </IconButton>
    </div>
  )
}

export default React.memo(Header)
