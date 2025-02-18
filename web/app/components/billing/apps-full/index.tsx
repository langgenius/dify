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
      <div className='shadow-xs col-span-1 flex min-h-[160px] cursor-pointer flex-col rounded-lg border-2 border-solid border-transparent px-3.5 pt-3.5 transition-all duration-200 ease-in-out hover:shadow-lg'>
        <div className={cn(s.textGradient, 'text-base font-semibold leading-[24px]')}>
          <div>{t('billing.apps.fullTipLine1')}</div>
          <div>{t('billing.apps.fullTipLine2')}</div>
        </div>
        <div className='mt-8 flex'>
          <UpgradeBtn loc='app-create' />
        </div>
      </div>
    </GridMask>
  )
}
export default React.memo(AppsFull)
