'use client'

import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'

type AgentMonitoringKey = I18nKeysWithPrefix<'agentV2', 'agentDetail.monitoring.'>

export type AgentMonitoringMetric = {
  id: string
  titleKey: AgentMonitoringKey
  explanationKey: AgentMonitoringKey
  tone: 'blue' | 'green' | 'orange'
  value: number
  valueType?: 'number' | 'currency' | 'decimal'
  unitKey?: AgentMonitoringKey
  change: number
  icon: string
  bars: number[]
}

const barClassNames: Record<AgentMonitoringMetric['tone'], string> = {
  blue: 'bg-util-colors-blue-blue-500/25',
  green: 'bg-util-colors-teal-teal-500/25',
  orange: 'bg-util-colors-orange-orange-500/25',
}

const formatMetricValue = (metric: AgentMonitoringMetric) => {
  if (metric.valueType === 'currency') {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(metric.value)
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: metric.valueType === 'decimal' ? 1 : 0,
  }).format(metric.value)
}

type MetricCardProps = {
  metric: AgentMonitoringMetric
  periodName: string
}

export function MetricCard({
  metric,
  periodName,
}: MetricCardProps) {
  const { t } = useTranslation('agentV2')
  const value = formatMetricValue(metric)
  const changeLabel = new Intl.NumberFormat(undefined, {
    signDisplay: 'always',
    maximumFractionDigits: 1,
  }).format(metric.change)

  return (
    <article className="flex min-h-70 min-w-0 flex-col rounded-xl bg-components-chart-bg px-6 py-4 shadow-xs">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate system-md-semibold text-text-primary">
              {t(metric.titleKey)}
            </h3>
            <Popover>
              <PopoverTrigger
                openOnHover
                delay={300}
                closeDelay={200}
                aria-label={t(metric.explanationKey)}
                render={(
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden">
                    <span aria-hidden className="i-ri-question-line size-3.5 text-text-quaternary hover:text-text-tertiary" />
                  </span>
                )}
              />
              <PopoverContent
                placement="top"
                popupClassName="max-w-[300px] px-3 py-2 system-xs-regular text-text-tertiary"
              >
                {t(metric.explanationKey)}
              </PopoverContent>
            </Popover>
          </div>
          <p className="mt-1 truncate system-xs-regular text-text-tertiary">
            {periodName}
          </p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-state-base-hover text-text-tertiary">
          <span aria-hidden className={cn(metric.icon, 'size-4')} />
        </span>
      </div>

      <div className="mt-5 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-3xl leading-9 font-normal text-text-primary">
            {value}
            {metric.unitKey && (
              <span className="ml-1 system-sm-regular text-text-tertiary">
                {t(metric.unitKey)}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 system-xs-medium text-text-success">
            <span aria-hidden className="i-ri-arrow-up-line size-3.5" />
            <span>
              {t('agentDetail.monitoring.change', { value: `${changeLabel}%` })}
            </span>
          </div>
        </div>
      </div>

      <div aria-hidden className="mt-auto flex h-24 items-end gap-1.5 pt-5">
        {metric.bars.map((height, index) => (
          <span
            key={`${metric.id}-${index}`}
            className={cn('min-w-0 flex-1 rounded-t-sm', barClassNames[metric.tone])}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </article>
  )
}
