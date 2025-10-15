import Tooltip from '@/app/components/base/tooltip'
import React from 'react'
import { useTranslation } from 'react-i18next'

const GlobalInputs = () => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center gap-x-1'>
      <span className='system-sm-semibold-uppercase text-text-secondary'>
        {t('datasetPipeline.inputFieldPanel.globalInputs.title')}
      </span>
      <Tooltip
        popupContent={t('datasetPipeline.inputFieldPanel.globalInputs.tooltip')}
        popupClassName='w-[240px]'
      />
    </div>
  )
}

export default React.memo(GlobalInputs)
