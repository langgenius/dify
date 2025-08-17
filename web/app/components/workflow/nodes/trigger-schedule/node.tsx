import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.triggerSchedule'

const Node: FC<NodeProps<ScheduleTriggerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  const getFormattedDateTime = () => {
    const defaultTime = data.visual_config?.time || '11:30 AM'
    const today = new Date()

    if (data.frequency === 'daily' || data.frequency === 'weekly') {
      const [time, period] = defaultTime.split(' ')
      const [hour, minute] = time.split(':')
      let displayHour = Number.parseInt(hour)
      if (period === 'PM' && displayHour !== 12) displayHour += 12
      if (period === 'AM' && displayHour === 12) displayHour = 0

      const nextExecution = new Date(today)
      nextExecution.setHours(displayHour, Number.parseInt(minute), 0, 0)

      if (data.frequency === 'weekly') {
        const selectedDay = data.visual_config?.weekdays?.[0] || 'sun'
        const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
        const targetDay = dayMap[selectedDay as keyof typeof dayMap]
        const currentDay = today.getDay()
        const daysUntilNext = (targetDay - currentDay + 7) % 7
        if (daysUntilNext === 0 && nextExecution <= today)
          nextExecution.setDate(today.getDate() + 7)
         else
          nextExecution.setDate(today.getDate() + daysUntilNext)
      }
 else if (nextExecution <= today) {
        nextExecution.setDate(today.getDate() + 1)
      }

      return `${nextExecution.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })} ${nextExecution.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })}`
    }

    const now = new Date()
    return `${now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })} ${now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`
  }

  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
        {t(`${i18nPrefix}.nextExecutionTime`)}
      </div>
      <div className="flex h-[26px] items-center rounded-md bg-workflow-block-parma-bg px-2 text-xs text-text-secondary">
        {getFormattedDateTime()}
      </div>
    </div>
  )
}

export default React.memo(Node)
