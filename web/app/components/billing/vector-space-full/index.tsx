'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import GridMask from '@/app/components/base/grid-mask'
import { cn } from '@/utils/classnames'
import UpgradeBtn from '../upgrade-btn'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import s from './style.module.css'

const VectorSpaceFull: FC = () => {
  const { t } = useTranslation()

  return (
    <GridMask wrapperClassName="border border-gray-200 rounded-xl" canvasClassName="rounded-xl" gradientClassName="rounded-xl">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between">
          <div className={cn(s.textGradient, 'text-base font-semibold leading-[24px]')}>
            <div>{t('vectorSpace.fullTip', { ns: 'billing' })}</div>
            <div>{t('vectorSpace.fullSolution', { ns: 'billing' })}</div>
          </div>
          <UpgradeBtn loc="knowledge-add-file" />
        </div>
        <VectorSpaceInfo className="pt-4" />
      </div>
    </GridMask>
  )
}
export default React.memo(VectorSpaceFull)
