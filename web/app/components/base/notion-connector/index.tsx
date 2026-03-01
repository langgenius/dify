import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../button'
import { Notion } from '../icons/src/public/common'
import { Icon3Dots } from '../icons/src/vender/line/others'

type NotionConnectorProps = {
  onSetting: () => void
}

const NotionConnector = ({ onSetting }: NotionConnectorProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-start rounded-2xl bg-workflow-process-bg p-6">
      <div className="mb-2 h-12 w-12 rounded-[10px] border-[0.5px] border-components-card-border p-3 shadow-lg shadow-shadow-shadow-5">
        <Notion className="size-6" />
      </div>
      <div className="mb-1 flex flex-col gap-y-1 pb-3 pt-1">
        <span className="system-md-semibold text-text-secondary">
          {t('stepOne.notionSyncTitle', { ns: 'datasetCreation' })}
          <Icon3Dots className="relative -left-1.5 -top-2.5 inline h-4 w-4 text-text-secondary" />
        </span>
        <div className="system-sm-regular text-text-tertiary">{t('stepOne.notionSyncTip', { ns: 'datasetCreation' })}</div>
      </div>
      <Button variant="primary" onClick={onSetting}>{t('stepOne.connect', { ns: 'datasetCreation' })}</Button>
    </div>
  )
}

export default React.memo(NotionConnector)
