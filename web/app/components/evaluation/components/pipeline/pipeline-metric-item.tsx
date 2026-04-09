'use client'

import type { MetricOption } from '../../types'
import Checkbox from '@/app/components/base/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'

type PipelineMetricItemProps = {
  metric: MetricOption
  selected: boolean
  onToggle: () => void
  disabledCondition: boolean
}

const PipelineMetricItem = ({
  metric,
  selected,
  onToggle,
  disabledCondition,
}: PipelineMetricItemProps) => {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 text-left"
        onClick={onToggle}
      >
        <Checkbox checked={selected} />
        <span className="truncate system-sm-medium text-text-secondary">{metric.label}</span>
        <Tooltip>
          <TooltipTrigger
            render={(
              <span className="flex h-4 w-4 items-center justify-center text-text-quaternary">
                <span aria-hidden="true" className="i-ri-question-line h-3.5 w-3.5" />
              </span>
            )}
          />
          <TooltipContent>
            {metric.description}
          </TooltipContent>
        </Tooltip>
      </button>

      <button
        type="button"
        disabled={disabledCondition}
        className={cn(
          'system-xs-medium text-text-tertiary',
          disabledCondition && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
        )}
      >
        + Condition
      </button>
    </div>
  )
}

export default PipelineMetricItem
