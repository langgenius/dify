import React from 'react'
import { useTranslation } from 'react-i18next'

const FooterTips = () => {
  const { t } = useTranslation()

  return (
    <div className='system-xs-regular flex grow flex-col justify-end p-4 pt-2 text-text-tertiary'>
      {t('datasetPipeline.testRun.tooltip')}
    </div>
  )
}

export default React.memo(FooterTips)
