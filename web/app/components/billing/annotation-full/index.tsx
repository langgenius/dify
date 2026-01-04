'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import GridMask from '@/app/components/base/grid-mask'
import { cn } from '@/utils/classnames'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'
import Usage from './usage'

const AnnotationFull: FC = () => {
  const { t } = useTranslation()

  return (
    <GridMask wrapperClassName="rounded-lg" canvasClassName="rounded-lg" gradientClassName="rounded-lg">
      <div className="mt-6 flex cursor-pointer flex-col rounded-lg border-2 border-solid border-transparent px-3.5 py-4 shadow-md transition-all duration-200 ease-in-out">
        <div className="flex items-center justify-between">
          <div className={cn(s.textGradient, 'text-base font-semibold leading-[24px]')}>
            <div>{t('annotatedResponse.fullTipLine1', { ns: 'billing' })}</div>
            <div>{t('annotatedResponse.fullTipLine2', { ns: 'billing' })}</div>
          </div>
          <div className="flex">
            <UpgradeBtn loc="annotation-create" />
          </div>
        </div>
        <Usage className="mt-4" />
      </div>
    </GridMask>
  )
}
export default React.memo(AnnotationFull)
