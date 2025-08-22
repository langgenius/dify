import React from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber } from '@/app/components/base/input-number'

type OnMinuteSelectorProps = {
  value?: number
  onChange: (value: number) => void
}

const OnMinuteSelector = ({ value = 0, onChange }: OnMinuteSelectorProps) => {
  const { t } = useTranslation()

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-gray-500">
        {t('workflow.nodes.triggerSchedule.onMinute')}
      </label>
      <div className="flex items-center gap-2">
        <InputNumber
          value={value}
          onChange={newValue => onChange(newValue || 0)}
          min={0}
          max={59}
          className="text-center"
          placeholder="0"
        />
        <span className="text-xs text-gray-500">
          {t('workflow.nodes.triggerSchedule.minutesLabel')}
        </span>
      </div>
    </div>
  )
}

export default OnMinuteSelector
