'use client'

import type { MetricOption } from '../types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { getTranslatedMetricDescription } from '../default-metric-descriptions'

type FixedMetricItemProps = {
  metric: MetricOption
  selected: boolean
  onToggle: () => void
}

const FixedMetricItem = ({ metric, selected, onToggle }: FixedMetricItemProps) => {
  const { t } = useTranslation(['evaluation'])
  const labelId = useId()
  const metricDescription = getTranslatedMetricDescription(t, metric.id, metric.description)

  return (
    <div className="flex h-8 items-center gap-3 px-1 py-1">
      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-start">
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-labelledby={labelId} />
        <span id={labelId} className="truncate system-sm-medium text-text-secondary">
          {metric.label}
        </span>
      </label>
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
    </div>
  )
}

export default FixedMetricItem
