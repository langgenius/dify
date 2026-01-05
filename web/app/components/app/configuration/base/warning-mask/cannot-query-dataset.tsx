'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import WarningMask from '.'

export type IFormattingChangedProps = {
  onConfirm: () => void
}

const FormattingChanged: FC<IFormattingChangedProps> = ({
  onConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <WarningMask
      title={t('feature.dataSet.queryVariable.unableToQueryDataSet', { ns: 'appDebug' })}
      description={t('feature.dataSet.queryVariable.unableToQueryDataSetTip', { ns: 'appDebug' })}
      footer={(
        <div className="flex space-x-2">
          <Button variant="primary" className="flex !w-[96px] justify-start" onClick={onConfirm}>
            <span className="text-[13px] font-medium">{t('feature.dataSet.queryVariable.ok', { ns: 'appDebug' })}</span>
          </Button>
        </div>
      )}
    />
  )
}
export default React.memo(FormattingChanged)
