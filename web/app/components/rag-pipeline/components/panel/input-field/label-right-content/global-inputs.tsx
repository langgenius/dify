import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'

const GlobalInputs = () => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span className="system-sm-semibold-uppercase text-text-secondary">
        {t('inputFieldPanel.globalInputs.title', { ns: 'datasetPipeline' })}
      </span>
      <Tooltip
        popupContent={t('inputFieldPanel.globalInputs.tooltip', { ns: 'datasetPipeline' })}
        popupClassName="w-[240px]"
      />
    </div>
  )
}

export default React.memo(GlobalInputs)
