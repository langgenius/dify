import type { ScheduleTriggerNodeType } from '../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { getFormattedExecutionTimes } from '../utils/execution-time-calculator'

type NextExecutionTimesProps = {
  data: ScheduleTriggerNodeType
}

const NextExecutionTimes = ({ data }: NextExecutionTimesProps) => {
  const { t } = useTranslation()

  if (!data.frequency)
    return null

  const executionTimes = getFormattedExecutionTimes(data, 5)

  if (executionTimes.length === 0)
    return null

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-500">
        {t('nodes.triggerSchedule.nextExecutionTimes', { ns: 'workflow' })}
      </label>
      <div className="flex min-h-[80px] flex-col rounded-xl bg-components-input-bg-normal py-2">
        {executionTimes.map((time, index) => (
          <div key={index} className="flex items-baseline text-xs">
            <span className="w-6 select-none text-right font-mono font-normal leading-[150%] tracking-wider text-text-quaternary">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="pl-2 pr-3 font-mono font-normal leading-[150%] tracking-wider text-text-secondary">
              {time}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default NextExecutionTimes
