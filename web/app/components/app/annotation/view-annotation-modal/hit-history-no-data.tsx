'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ClockFastForward } from '@/app/components/base/icons/src/vender/line/time'

const HitHistoryNoData: FC = () => {
  const { t } = useTranslation()
  return (
    <div className='mx-auto mt-20 w-[480px] p-5 rounded-2xl bg-background-section-burn space-y-2'>
      <div className='inline-block p-3 rounded-lg border border-divider-subtle'>
        <ClockFastForward className='w-5 h-5 text-text-tertiary' />
      </div>
      <div className='system-sm-regular text-text-tertiary'>{t('appAnnotation.viewModal.noHitHistory')}</div>
    </div>
  )
}

export default React.memo(HitHistoryNoData)
