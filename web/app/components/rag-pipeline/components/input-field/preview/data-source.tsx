import React from 'react'
import { useTranslation } from 'react-i18next'

const DataSource = () => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col'>
      <div className='system-sm-semibold-uppercase px-4 pt-2 text-text-secondary'>
        {t('datasetPipeline.inputFieldPanel.preview.stepOneTitle')}
      </div>
    </div>
  )
}

export default React.memo(DataSource)
