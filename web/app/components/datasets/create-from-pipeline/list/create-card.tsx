import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddCircleLine } from '@remixicon/react'
import CreateFromScratchModal from '../create-options/create-from-scratch-modal'

const CreateCard = () => {
  const { t } = useTranslation()

  const [showCreateModal, setShowCreateModal] = useState(false)

  const openCreateFromScratch = useCallback(() => {
    setShowCreateModal(true)
  }, [])

  const closeCreateFromScratch = useCallback(() => {
    setShowCreateModal(false)
  }, [])

  return (
    <div
      className='group relative flex h-[132px] cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3'
      onClick={openCreateFromScratch}
    >
      <div className='flex items-center gap-x-3 p-4 pb-2'>
        <div className='flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-divider-regular bg-background-section group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover'>
          <RiAddCircleLine className='size-5 text-text-quaternary group-hover:text-text-accent' />
        </div>
        <div className='system-md-semibold truncate text-text-primary'>
          {t('datasetPipeline.creation.createFromScratch.title')}
        </div>
      </div>
      <p className='system-xs-regular line-clamp-3 px-4 py-1 text-text-tertiary'>
        {t('datasetPipeline.creation.createFromScratch.description')}
      </p>
      <CreateFromScratchModal
        show={showCreateModal}
        onClose={closeCreateFromScratch}
      />
    </div>
  )
}

export default React.memo(CreateCard)
