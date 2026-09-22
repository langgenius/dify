import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const GlobalInputs = () => {
  const titleId = React.useId()

  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span id={titleId} className="system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['inputFieldPanel.globalInputs.title'], { ns: 'datasetPipeline' })}
      </span>
      <Infotip>
        <InfotipTrigger aria-labelledby={titleId} />
        <InfotipContent aria-labelledby={titleId} className="w-60">
          {t(($) => $['inputFieldPanel.globalInputs.tooltip'], { ns: 'datasetPipeline' })}
        </InfotipContent>
      </Infotip>
    </div>
  )
}

export default React.memo(GlobalInputs)
