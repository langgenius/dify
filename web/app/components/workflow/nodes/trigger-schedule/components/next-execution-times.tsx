import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from '../types'
import { getFormattedExecutionTimes } from '../utils/execution-time-calculator'

type NextExecutionTimesProps = {
  data: ScheduleTriggerNodeType
}

const NextExecutionTimes = ({ data }: NextExecutionTimesProps) => {
  const { t } = useTranslation()

  // Don't show next execution times for 'once' frequency
  if (data.frequency === 'once')
    return null

  const executionTimes = getFormattedExecutionTimes(data, 5)

  if (executionTimes.length === 0)
    return null

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-500">
        {t('workflow.nodes.triggerSchedule.nextExecutionTimes')}
      </label>
      <div className="space-y-2 rounded-lg bg-components-input-bg-normal p-3">
        {executionTimes.map((time, index) => (
          <div key={index} className="text-xs text-text-secondary">
            {time}
          </div>
        ))}
      </div>
    </div>
  )
}

export default NextExecutionTimes
