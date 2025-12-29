import { RiHistoryLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const EmptyRecords = () => {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl bg-workflow-process-bg p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <RiHistoryLine className="h-5 w-5 text-text-tertiary" />
      </div>
      <div className="my-2 text-[13px] font-medium leading-4 text-text-tertiary">{t('noRecentTip', { ns: 'datasetHitTesting' })}</div>
    </div>
  )
}

export default React.memo(EmptyRecords)
