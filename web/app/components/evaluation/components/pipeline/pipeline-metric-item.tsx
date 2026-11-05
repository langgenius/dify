'use client'

import type { MetricOption } from '../../types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { getTranslatedMetricDescription } from '../../default-metric-descriptions'

type PipelineMetricItemProps = {
  metric: MetricOption
  selected: boolean
  onToggle: () => void
}

const PipelineMetricItem = ({ metric, selected, onToggle }: PipelineMetricItemProps) => {
  const { t } = useTranslation(['evaluation'])
  const metricDescription = getTranslatedMetricDescription(t, metric.id, metric.description)

  return (
    <div className="flex h-8 items-center gap-3 px-1 py-1">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 text-start"
        onClick={onToggle}
      >
        <Checkbox checked={selected} />
        <span className="truncate system-sm-medium text-text-secondary">{metric.label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex h-4 w-4 items-center justify-center text-text-quaternary">
                <span aria-hidden="true" className="i-ri-question-line h-3.5 w-3.5" />
              </span>
            }
          />
          <TooltipContent>{metricDescription}</TooltipContent>
        </Tooltip>
      </button>
    </div>
  )
}

export default PipelineMetricItem
