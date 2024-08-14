'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import WarningMask from '.'
import Button from '@/app/components/base/button'

export type IFormattingChangedProps = {
  onConfirm: () => void
  onCancel: () => void
}

const icon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.33337 6.66667C1.33337 6.66667 2.67003 4.84548 3.75593 3.75883C4.84183 2.67218 6.34244 2 8.00004 2C11.3137 2 14 4.68629 14 8C14 11.3137 11.3137 14 8.00004 14C5.26465 14 2.95678 12.1695 2.23455 9.66667M1.33337 6.66667V2.66667M1.33337 6.66667H5.33337" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const FormattingChanged: FC<IFormattingChangedProps> = ({
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <WarningMask
      title={t('appDebug.formattingChangedTitle')}
      description={t('appDebug.formattingChangedText')}
      footer={
        <div className='flex space-x-2'>
          <Button variant='primary' className='flex space-x-2' onClick={onConfirm}>
            {icon}
            <span>{t('common.operation.refresh')}</span>
          </Button>
          <Button onClick={onCancel}>{t('common.operation.cancel') as string}</Button>
        </div>
      }
    />
  )
}
export default React.memo(FormattingChanged)
