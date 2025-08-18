import React from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber } from '@/app/components/base/input-number'
import { SimpleSegmentedControl } from './simple-segmented-control'

type RecurConfigProps = {
  recurEvery?: number
  recurUnit?: 'hours' | 'minutes'
  onRecurEveryChange: (value: number) => void
  onRecurUnitChange: (unit: 'hours' | 'minutes') => void
}

const RecurConfig = ({
  recurEvery = 1,
  recurUnit = 'hours',
  onRecurEveryChange,
  onRecurUnitChange,
}: RecurConfigProps) => {
  const { t } = useTranslation()

  const unitOptions = [
    {
      text: t('workflow.nodes.triggerSchedule.hours'),
      value: 'hours' as const,
    },
    {
      text: t('workflow.nodes.triggerSchedule.minutes'),
      value: 'minutes' as const,
    },
  ]

  return (
    <div className="flex gap-3">
      <div className="flex-[2]">
        <label className="mb-2 block text-xs font-medium text-text-tertiary">
          {t('workflow.nodes.triggerSchedule.recurEvery')}
        </label>
        <InputNumber
          value={recurEvery}
          onChange={value => onRecurEveryChange(value || 1)}
          min={1}
          className="text-center"
        />
      </div>
      <div className="flex-1">
        <label className="mb-2 block text-xs font-medium text-text-tertiary">
          &nbsp;
        </label>
        <SimpleSegmentedControl
          options={unitOptions}
          value={recurUnit}
          onChange={onRecurUnitChange}
        />
      </div>
    </div>
  )
}

export default RecurConfig
