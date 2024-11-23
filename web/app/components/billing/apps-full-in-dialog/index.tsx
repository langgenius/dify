'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '../upgrade-btn'
import AppsInfo from '../usage-info/apps-info'
import s from './style.module.css'
import cn from '@/utils/classnames'
import GridMask from '@/app/components/base/grid-mask'

const AppsFull: FC<{ loc: string; className?: string }> = ({
  loc,
  className,
}) => {
  const { t } = useTranslation()

  return (
    <GridMask wrapperClassName='rounded-lg' canvasClassName='rounded-lg' gradientClassName='rounded-lg'>
      <div className={cn(
        'mt-6 px-3.5 py-4 border-2 border-solid border-transparent rounded-lg shadow-md flex flex-col transition-all duration-200 ease-in-out cursor-pointer',
        className,
      )}>
        <div className='flex justify-between items-center'>
          <div className={cn(s.textGradient, 'leading-[24px] text-base font-semibold')}>
            <div>{t('billing.apps.fullTipLine1')}</div>
            <div>{t('billing.apps.fullTipLine2')}</div>
          </div>
          <div className='flex'>
            <UpgradeBtn loc={loc} />
          </div>
        </div>
        <AppsInfo className='mt-4' />
      </div>
    </GridMask>
  )
}
export default React.memo(AppsFull)
