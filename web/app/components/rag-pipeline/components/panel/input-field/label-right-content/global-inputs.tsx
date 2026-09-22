import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const GlobalInputs = () => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span className="system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['inputFieldPanel.globalInputs.title'], { ns: 'datasetPipeline' })}
      </span>
      <Infotip>
        <InfotipTrigger
          aria-label={t(($) => $['inputFieldPanel.globalInputs.tooltip'], {
            ns: 'datasetPipeline',
          })}
        />
        <InfotipContent
          aria-label={t(($) => $['inputFieldPanel.globalInputs.tooltip'], {
            ns: 'datasetPipeline',
          })}
          className="w-60"
        >
          {t(($) => $['inputFieldPanel.globalInputs.tooltip'], { ns: 'datasetPipeline' })}
        </InfotipContent>
      </Infotip>
    </div>
  )
}

export default React.memo(GlobalInputs)
