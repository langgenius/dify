'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '../upgrade-btn'
import Usage from './usage'
import s from './style.module.css'
import cn from '@/utils/classnames'
import GridMask from '@/app/components/base/grid-mask'

const AnnotationFull: FC = () => {
  const { t } = useTranslation()

  return (
    <GridMask wrapperClassName='rounded-lg' canvasClassName='rounded-lg' gradientClassName='rounded-lg'>
      <div className='mt-6 px-3.5 py-4 border-2 border-solid border-transparent rounded-lg shadow-md flex flex-col transition-all duration-200 ease-in-out cursor-pointer'>
        <div className='flex justify-between items-center'>
          <div className={cn(s.textGradient, 'leading-[24px] text-base font-semibold')}>
            <div>{t('billing.annotatedResponse.fullTipLine1')}</div>
            <div>{t('billing.annotatedResponse.fullTipLine2')}</div>
          </div>
          <div className='flex'>
            <UpgradeBtn loc={'annotation-create'} />
          </div>
        </div>
        <Usage className='mt-4' />
      </div>
    </GridMask>
  )
}
export default React.memo(AnnotationFull)
