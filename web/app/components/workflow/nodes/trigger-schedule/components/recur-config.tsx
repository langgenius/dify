import React from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber } from '@/app/components/base/input-number'

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

  return (
    <div className="flex gap-3">
      <div className="flex-[2]">
        <label className="mb-2 block text-xs font-medium text-gray-500">
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
        <label className="mb-2 block text-xs font-medium text-gray-500">
          &nbsp;
        </label>
        <div className="border-components-input-border-normal relative flex h-9 rounded-lg border bg-components-input-bg-normal p-0.5">
          <div
            className={`absolute bottom-0.5 top-0.5 rounded-md bg-white shadow-xs transition-transform duration-200 ease-in-out ${
              recurUnit === 'hours' ? 'left-0.5 w-[calc(50%-2px)]' : 'left-[calc(50%+2px)] w-[calc(50%-2px)]'
            }`}
          />
          <button
            type="button"
            className={`relative z-10 flex flex-1 items-center justify-center text-xs font-medium transition-colors ${
              recurUnit === 'hours'
                ? 'text-util-colors-blue-brand-blue-brand-600'
                : 'text-text-primary hover:text-text-secondary'
            }`}
            onClick={() => onRecurUnitChange('hours')}
          >
            {t('workflow.nodes.triggerSchedule.hours')}
          </button>
          <button
            type="button"
            className={`relative z-10 flex flex-1 items-center justify-center text-xs font-medium transition-colors ${
              recurUnit === 'minutes'
                ? 'text-util-colors-blue-brand-blue-brand-600'
                : 'text-text-primary hover:text-text-secondary'
            }`}
            onClick={() => onRecurUnitChange('minutes')}
          >
            {t('workflow.nodes.triggerSchedule.minutes')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RecurConfig
