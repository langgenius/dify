'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ClockFastForward } from '@/app/components/base/icons/src/vender/line/time'

const HitHistoryNoData: FC = () => {
  const { t } = useTranslation()
  return (
    <div className='bg-background-section-burn mx-auto mt-20 w-[480px] space-y-2 rounded-2xl p-5'>
      <div className='border-divider-subtle inline-block rounded-lg border p-3'>
        <ClockFastForward className='text-text-tertiary h-5 w-5' />
      </div>
      <div className='system-sm-regular text-text-tertiary'>{t('appAnnotation.viewModal.noHitHistory')}</div>
    </div>
  )
}

export default React.memo(HitHistoryNoData)
