import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from '../types'

type NextExecutionTimesProps = {
  data: ScheduleTriggerNodeType
}

const NextExecutionTimes = ({ data }: NextExecutionTimesProps) => {
  const { t } = useTranslation()

  const getNextExecutionTimes = () => {
    const times: string[] = []
    const defaultTime = data.visual_config?.time || '11:30 AM'

    if (data.frequency === 'daily') {
      const [time, period] = defaultTime.split(' ')
      const [hour, minute] = time.split(':')
      let displayHour = Number.parseInt(hour)
      if (period === 'PM' && displayHour !== 12) displayHour += 12
      if (period === 'AM' && displayHour === 12) displayHour = 0

      for (let i = 0; i < 5; i++) {
        const nextExecution = new Date()
        nextExecution.setHours(displayHour, Number.parseInt(minute), 0, 0)
        nextExecution.setDate(nextExecution.getDate() + i + (nextExecution <= new Date() ? 1 : 0))

        const formattedTime = `${nextExecution.toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })} ${nextExecution.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}`

        times.push(formattedTime)
      }
    }
 else if (data.frequency === 'weekly') {
      const selectedDay = data.visual_config?.weekdays?.[0] || 'sun'
      const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
      const targetDay = dayMap[selectedDay as keyof typeof dayMap]

      const [time, period] = defaultTime.split(' ')
      const [hour, minute] = time.split(':')
      let displayHour = Number.parseInt(hour)
      if (period === 'PM' && displayHour !== 12) displayHour += 12
      if (period === 'AM' && displayHour === 12) displayHour = 0

      for (let i = 0; i < 5; i++) {
        const today = new Date()
        const currentDay = today.getDay()
        const daysUntilNext = (targetDay - currentDay + 7) % 7
        const nextExecution = new Date(today)
        nextExecution.setHours(displayHour, Number.parseInt(minute), 0, 0)

        let finalDate = today.getDate() + daysUntilNext + (i * 7)
        if (i === 0 && daysUntilNext === 0 && nextExecution <= today)
          finalDate += 7

        nextExecution.setDate(finalDate)

        const formattedTime = `${nextExecution.toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })} ${nextExecution.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}`

        times.push(formattedTime)
      }
    }
 else {
      for (let i = 0; i < 5; i++) {
        const nextExecution = new Date()
        nextExecution.setDate(nextExecution.getDate() + i + 1)

        const formattedTime = `${nextExecution.toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })} ${nextExecution.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}`

        times.push(formattedTime)
      }
    }

    return times
  }

  const executionTimes = getNextExecutionTimes()

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
