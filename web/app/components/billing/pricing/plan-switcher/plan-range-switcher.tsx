'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '../../../base/switch'

export enum PlanRange {
  monthly = 'monthly',
  yearly = 'yearly',
}

type PlanRangeSwitcherProps = {
  value: PlanRange
  onChange: (value: PlanRange) => void
}

const PlanRangeSwitcher: FC<PlanRangeSwitcherProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-end gap-x-3 pr-5'>
      <Switch
        size='l'
        defaultValue={value === PlanRange.yearly}
        onChange={(v) => {
          onChange(v ? PlanRange.yearly : PlanRange.monthly)
        }}
      />
      <span className='system-md-regular text-text-tertiary'>
        {t('billing.plansCommon.annualBilling', { percent: 17 })}
      </span>
    </div>
  )
}
export default React.memo(PlanRangeSwitcher)
