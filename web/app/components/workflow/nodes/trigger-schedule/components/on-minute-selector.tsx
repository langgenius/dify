import React from 'react'
import { useTranslation } from 'react-i18next'
import InputNumberWithSlider from '@/app/components/workflow/nodes/_base/components/input-number-with-slider'

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
      <div className="space-y-2">
        <InputNumberWithSlider
          value={value}
          min={0}
          max={59}
          onChange={onChange}
        />
        <div className="text-xs text-gray-500">
          {t('workflow.nodes.triggerSchedule.onMinuteDescription')}
        </div>
      </div>
    </div>
  )
}

export default OnMinuteSelector
