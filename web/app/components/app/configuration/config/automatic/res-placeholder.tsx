'use client'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const ResPlaceholder: FC = () => {
  const { t } = useTranslation()
  return (
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8'>
      <Generator className='size-8 text-text-quaternary' />
      <div className='text-center text-[13px] font-normal leading-5 text-text-tertiary'>
        <div>{t('appDebug.generate.newNoDataLine1')}</div>
      </div>
    </div>
  )
}
export default React.memo(ResPlaceholder)
