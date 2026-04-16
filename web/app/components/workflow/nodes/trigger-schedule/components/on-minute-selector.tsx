import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Slider } from '@/app/components/base/ui/slider'

type OnMinuteSelectorProps = {
  value?: number
  onChange: (value: number) => void
}

const OnMinuteSelector = ({ value = 0, onChange }: OnMinuteSelectorProps) => {
  const { t } = useTranslation()

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-gray-500">
        {t('nodes.triggerSchedule.onMinute', { ns: 'workflow' })}
      </label>
      <div className="relative flex h-8 items-center rounded-lg bg-components-input-bg-normal">
        <div className="flex h-full w-12 shrink-0 items-center justify-center text-[13px] text-components-input-text-filled">
          {value}
        </div>
        <div className="absolute top-0 left-12 h-full w-px bg-components-panel-bg"></div>
        <div className="flex h-full grow items-center pr-3 pl-4">
          <Slider
            className="w-full"
            value={value}
            min={0}
            max={59}
            step={1}
            onValueChange={onChange}
            aria-label={t('nodes.triggerSchedule.onMinute', { ns: 'workflow' })}
          />
        </div>
      </div>
    </div>
  )
}

export default OnMinuteSelector
