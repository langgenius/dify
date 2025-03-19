'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import WarningMask from '.'
import Button from '@/app/components/base/button'

export type IFormattingChangedProps = {
  onConfirm: () => void
}

const FormattingChanged: FC<IFormattingChangedProps> = ({
  onConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <WarningMask
      title={t('appDebug.feature.dataSet.queryVariable.unableToQueryDataSet')}
      description={t('appDebug.feature.dataSet.queryVariable.unableToQueryDataSetTip')}
      footer={
        <div className='flex space-x-2'>
          <Button variant='primary' className='flex !w-[96px] justify-start' onClick={onConfirm}>
            <span className='text-[13px] font-medium'>{t('appDebug.feature.dataSet.queryVariable.ok')}</span>
          </Button>
        </div>
      }
    />
  )
}
export default React.memo(FormattingChanged)
