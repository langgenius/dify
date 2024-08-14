'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import WarningMask from '.'
import Button from '@/app/components/base/button'

export type IHasNotSetAPIProps = {
  isTrailFinished: boolean
  onSetting: () => void
}

const icon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 6.00001L14 2.00001M14 2.00001H9.99999M14 2.00001L8 8M6.66667 2H5.2C4.0799 2 3.51984 2 3.09202 2.21799C2.71569 2.40973 2.40973 2.71569 2.21799 3.09202C2 3.51984 2 4.07989 2 5.2V10.8C2 11.9201 2 12.4802 2.21799 12.908C2.40973 13.2843 2.71569 13.5903 3.09202 13.782C3.51984 14 4.07989 14 5.2 14H10.8C11.9201 14 12.4802 14 12.908 13.782C13.2843 13.5903 13.5903 13.2843 13.782 12.908C14 12.4802 14 11.9201 14 10.8V9.33333" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>

)

const HasNotSetAPI: FC<IHasNotSetAPIProps> = ({
  isTrailFinished,
  onSetting,
}) => {
  const { t } = useTranslation()

  return (
    <WarningMask
      title={isTrailFinished ? t('appDebug.notSetAPIKey.trailFinished') : t('appDebug.notSetAPIKey.title')}
      description={t('appDebug.notSetAPIKey.description')}
      footer={
        <Button variant='primary' className='flex space-x-2' onClick={onSetting}>
          <span>{t('appDebug.notSetAPIKey.settingBtn')}</span>
          {icon}
        </Button>}
    />
  )
}
export default React.memo(HasNotSetAPI)
