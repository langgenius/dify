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

  const getDisplayText = () => {
    if (data.mode === 'cron' && data.cron_expression)
      return data.cron_expression

    if (data.frequency)
      return t(`${i18nPrefix}.frequency.${data.frequency}`)

    return t(`${i18nPrefix}.notConfigured`)
  }

  const getNextExecutionText = () => {
    if (data.visual_config?.time)
      return `${t(`${i18nPrefix}.nextExecution`)}: ${data.visual_config.time}`

    return null
  }

  return (
    <div className="mb-1 px-3 py-1">
      <div className="text-xs font-medium text-gray-700">
        {t(`${i18nPrefix}.nodeTitle`)}
      </div>
      <div className="text-xs text-gray-500">
        {getDisplayText()}
      </div>
      {getNextExecutionText() && (
        <div className="text-xs text-blue-600">
          {getNextExecutionText()}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
