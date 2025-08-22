import React from 'react'
import { useTranslation } from 'react-i18next'
import Slider from '@/app/components/base/slider'

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
      <div className="flex h-8 items-center justify-between space-x-2">
        <div className="flex h-8 w-12 shrink-0 items-center justify-center rounded-lg bg-components-input-bg-normal text-[13px] text-components-input-text-filled">
          {value}
        </div>
        <Slider
          className="grow"
          value={value}
          min={0}
          max={59}
          step={1}
          onChange={onChange}
        />
      </div>
    </div>
  )
}

export default OnMinuteSelector
