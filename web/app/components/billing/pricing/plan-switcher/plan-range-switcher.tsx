'use client'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export enum PlanRange {
  monthly = 'monthly',
  yearly = 'yearly',
}

type PlanRangeSwitcherProps = {
  value: PlanRange
  onChange: (value: PlanRange) => void
}

function PlanRangeSwitcher({ value, onChange }: PlanRangeSwitcherProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-end gap-x-3 pr-5">
      <Switch
        aria-label={t(($) => $['plansCommon.yearlyBilling'], { ns: 'billing' })}
        size="lg"
        checked={value === PlanRange.yearly}
        onCheckedChange={(v) => {
          onChange(v ? PlanRange.yearly : PlanRange.monthly)
        }}
      />
      <span className="system-md-regular text-text-tertiary">
        {t(($) => $['plansCommon.annualBilling'], { ns: 'billing', percent: 17 })}
      </span>
    </div>
  )
}
export default React.memo(PlanRangeSwitcher)
