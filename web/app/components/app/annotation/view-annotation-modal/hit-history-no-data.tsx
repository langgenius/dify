'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ClockFastForward } from '@/app/components/base/icons/src/vender/line/time'

const HitHistoryNoData: FC = () => {
  const { t } = useTranslation()
  return (
    <div className='mx-auto mt-20 w-[480px] space-y-2 rounded-2xl bg-background-section-burn p-5'>
      <div className='inline-block rounded-lg border border-divider-subtle p-3'>
        <ClockFastForward className='h-5 w-5 text-text-tertiary' />
      </div>
      <div className='system-sm-regular text-text-tertiary'>{t('appAnnotation.viewModal.noHitHistory')}</div>
    </div>
  )
}

export default React.memo(HitHistoryNoData)
