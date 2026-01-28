import type { FC } from 'react'
import type { ScheduleTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { getNextExecutionTime } from './utils/execution-time-calculator'

const i18nPrefix = 'nodes.triggerSchedule'

const Node: FC<NodeProps<ScheduleTriggerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
        {t(`${i18nPrefix}.nextExecutionTime`, { ns: 'workflow' })}
      </div>
      <div className="flex h-[26px] items-center rounded-md bg-workflow-block-parma-bg px-2 text-xs text-text-secondary">
        <div className="w-0 grow">
          <div className="truncate" title={getNextExecutionTime(data)}>
            {getNextExecutionTime(data)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
