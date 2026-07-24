import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'

const Header = () => {
  const workflowStore = useWorkflowStore()

  const { t } = useTranslation()
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()

  const handleClose = useCallback(() => {
    const {
      isPreparingDataSource,
      setIsPreparingDataSource,
    } = workflowStore.getState()
    if (isPreparingDataSource)
      setIsPreparingDataSource?.(false)
    handleCancelDebugAndPreviewPanel()
  }, [workflowStore])

  return (
    <div className="flex items-center gap-x-2 pl-4 pr-3 pt-4">
      <div className="system-xl-semibold grow pl-1 pr-8 text-text-primary">
        {t('testRun.title', { ns: 'datasetPipeline' })}
      </div>
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center p-1.5"
        onClick={handleClose}
      >
        <RiCloseLine className="size-4 text-text-tertiary" />
      </button>
    </div>
  )
}

export default React.memo(Header)
