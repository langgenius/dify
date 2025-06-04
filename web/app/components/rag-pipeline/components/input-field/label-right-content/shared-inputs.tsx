import Tooltip from '@/app/components/base/tooltip'
import React from 'react'
import { useTranslation } from 'react-i18next'

const SharedInputs = () => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center gap-x-1'>
      <span className='system-sm-semibold-uppercase text-text-secondary'>
        {t('datasetPipeline.inputFieldPanel.sharedInputs.title')}
      </span>
      <Tooltip
        popupContent={t('datasetPipeline.inputFieldPanel.sharedInputs.tooltip')}
        popupClassName='!w-[300px]'
      />
    </div>
  )
}

export default React.memo(SharedInputs)
