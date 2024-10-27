'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'
import cn from '@/utils/classnames'
import GridMask from '@/app/components/base/grid-mask'

const AppsFull: FC = () => {
  const { t } = useTranslation()

  return (
    <GridMask wrapperClassName='rounded-lg' canvasClassName='rounded-lg' gradientClassName='rounded-lg'>
      <div className='col-span-1 px-3.5 pt-3.5 border-2 border-solid border-transparent rounded-lg shadow-xs min-h-[160px] flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg'>
        <div className={cn(s.textGradient, 'leading-[24px] text-base font-semibold')}>
          <div>{t('billing.apps.fullTipLine1')}</div>
          <div>{t('billing.apps.fullTipLine2')}</div>
        </div>
        <div className='flex mt-8'>
          <UpgradeBtn loc='app-create' />
        </div>
      </div>
    </GridMask>
  )
}
export default React.memo(AppsFull)
