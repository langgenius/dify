import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type NotionConnectorProps = {
  onSetting: () => void
}

const NotionConnector = ({ onSetting }: NotionConnectorProps) => {
  const { t } = useTranslation(['datasetCreation'])

  return (
    <div className="flex flex-col items-start rounded-2xl bg-workflow-process-bg p-6">
      <div className="mb-2 h-12 w-12 rounded-[10px] border-[0.5px] border-components-card-border p-3 shadow-lg shadow-shadow-shadow-5">
        <span aria-hidden className="i-custom-public-common-notion size-6" />
      </div>
      <div className="mb-1 flex flex-col gap-y-1 pt-1 pb-3">
        <span className="system-md-semibold text-text-secondary">
          {t(($) => $['stepOne.notionSyncTitle'], { ns: 'datasetCreation' })}
          <span
            aria-hidden
            className="relative -top-2.5 -left-1.5 i-custom-vender-line-others-icon-3-dots inline-block size-4 align-middle text-text-secondary"
          />
        </span>
        <div className="system-sm-regular text-text-tertiary">
          {t(($) => $['stepOne.notionSyncTip'], { ns: 'datasetCreation' })}
        </div>
      </div>
      <Button variant="primary" onClick={onSetting}>
        {t(($) => $['stepOne.connect'], { ns: 'datasetCreation' })}
      </Button>
    </div>
  )
}

export default React.memo(NotionConnector)
