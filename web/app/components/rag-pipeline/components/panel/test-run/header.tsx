import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useWorkflowInteractions } from '@/app/components/workflow/hooks'
import { RiCloseLine } from '@remixicon/react'

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
    <div className='flex items-center gap-x-2 pl-4 pr-3 pt-4'>
      <div className='system-xl-semibold grow pl-1 pr-8 text-text-primary'>
        {t('datasetPipeline.testRun.title')}
      </div>
      <button
        type='button'
        className='flex size-8 shrink-0 items-center justify-center p-1.5'
        onClick={handleClose}
      >
        <RiCloseLine className='size-4 text-text-tertiary' />
      </button>
    </div>
  )
}

export default React.memo(Header)
