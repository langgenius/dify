'use client'

import { useTranslation } from 'react-i18next'

const PipelineResultsPanel = () => {
  const { t } = useTranslation('evaluation')

  return (
    <div className="flex min-h-[360px] flex-1 items-center justify-center xl:min-h-0">
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <span aria-hidden="true" className="i-ri-file-list-3-line h-12 w-12 text-text-quaternary" />
        <div className="system-md-medium text-text-quaternary">{t('results.empty')}</div>
      </div>
    </div>
  )
}

export default PipelineResultsPanel
