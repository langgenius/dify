import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<ScheduleTriggerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mb-1 px-3 py-1">
      <div className="text-xs text-gray-700">
        {t('workflow.nodes.triggerSchedule.nodeTitle')}
      </div>
      {data.cron_expression && (
        <div className="text-xs text-gray-500">
          {data.cron_expression}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
