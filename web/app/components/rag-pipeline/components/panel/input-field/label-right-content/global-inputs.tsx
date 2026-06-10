import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'

const GlobalInputs = () => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span className="system-sm-semibold-uppercase text-text-secondary">
        {t('inputFieldPanel.globalInputs.title', { ns: 'datasetPipeline' })}
      </span>
      <Infotip aria-label={t('inputFieldPanel.globalInputs.tooltip', { ns: 'datasetPipeline' })} popupClassName="w-[240px]">
        {t('inputFieldPanel.globalInputs.tooltip', { ns: 'datasetPipeline' })}
      </Infotip>
    </div>
  )
}

export default React.memo(GlobalInputs)
