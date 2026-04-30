'use client'

import type { MetricOption } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { getTranslatedMetricDescription } from '../../default-metric-descriptions'
import { DEFAULT_PIPELINE_METRIC_THRESHOLD } from '../../store-utils'

type PipelineMetricItemProps = {
  metric: MetricOption
  selected: boolean
  onToggle: () => void
  disabledCondition: boolean
  threshold?: number
  onThresholdChange: (value: number) => void
}

const PipelineMetricItem = ({
  metric,
  selected,
  onToggle,
  disabledCondition,
  threshold = DEFAULT_PIPELINE_METRIC_THRESHOLD,
  onThresholdChange,
}: PipelineMetricItemProps) => {
  const { t } = useTranslation('evaluation')
  const metricDescription = getTranslatedMetricDescription(t, metric.id, metric.description)

  return (
    <div className="flex h-8 items-center justify-between gap-3 px-1 py-1">
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
            {metricDescription}
          </TooltipContent>
        </Tooltip>
      </button>

      {selected
        ? (
            <div className="flex items-center gap-2">
              <span className="system-xs-medium text-text-accent">{t('pipeline.passIf')}</span>
              <div className="w-[64px]">
                <Input
                  value={String(threshold)}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(event) => {
                    const parsedValue = Number(event.target.value)
                    if (!Number.isNaN(parsedValue))
                      onThresholdChange(parsedValue)
                  }}
                />
              </div>
            </div>
          )
        : (
            <button
              type="button"
              disabled={disabledCondition}
              className={cn(
                'flex items-center gap-0.5 system-xs-medium text-text-tertiary',
                disabledCondition && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
              )}
            >
              <span aria-hidden="true" className="i-ri-add-line h-3.5 w-3.5" />
              {t('conditions.addCondition')}
            </button>
          )}
    </div>
  )
}

export default PipelineMetricItem
