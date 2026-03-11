import * as React from 'react'
import { useTranslation } from 'react-i18next'

const EmptyFolder = () => {
  const { t } = useTranslation()

  return (
    <div className="flex size-full items-center justify-center rounded-[10px] bg-background-section px-1 py-1.5">
      <span className="text-text-tertiary system-xs-regular">{t('onlineDrive.emptyFolder', { ns: 'datasetPipeline' })}</span>
    </div>
  )
}

export default React.memo(EmptyFolder)
