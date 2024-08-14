'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '../upgrade-btn'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import s from './style.module.css'
import cn from '@/utils/classnames'
import GridMask from '@/app/components/base/grid-mask'

const VectorSpaceFull: FC = () => {
  const { t } = useTranslation()

  return (
    <GridMask wrapperClassName='border border-gray-200 rounded-xl' canvasClassName='rounded-xl' gradientClassName='rounded-xl'>
      <div className='py-5 px-6'>
        <div className='flex justify-between items-center'>
          <div className={cn(s.textGradient, 'leading-[24px] text-base font-semibold')}>
            <div>{t('billing.vectorSpace.fullTip')}</div>
            <div>{t('billing.vectorSpace.fullSolution')}</div>
          </div>
          <UpgradeBtn loc='knowledge-add-file' />
        </div>
        <VectorSpaceInfo className='pt-4' />
      </div>
    </GridMask>
  )
}
export default React.memo(VectorSpaceFull)
