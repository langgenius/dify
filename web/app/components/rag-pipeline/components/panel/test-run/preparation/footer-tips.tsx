import * as React from 'react'
import { useTranslation } from 'react-i18next'

const FooterTips = () => {
  const { t } = useTranslation()

  return (
    <div className="flex grow flex-col justify-end p-4 pt-2 text-text-tertiary system-xs-regular">
      {t('testRun.tooltip', { ns: 'datasetPipeline' })}
    </div>
  )
}

export default React.memo(FooterTips)
