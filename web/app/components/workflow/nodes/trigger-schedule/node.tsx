import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { getNextExecutionTime } from './utils/execution-time-calculator'

const i18nPrefix = 'workflow.nodes.triggerSchedule'

const Node: FC<NodeProps<ScheduleTriggerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
        {t(`${i18nPrefix}.nextExecutionTime`)}
      </div>
      <div className="flex h-[26px] items-center rounded-md bg-workflow-block-parma-bg px-2 text-xs text-text-secondary">
        {getNextExecutionTime(data)}
      </div>
    </div>
  )
}

export default React.memo(Node)
