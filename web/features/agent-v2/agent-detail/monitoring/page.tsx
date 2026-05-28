'use client'

import type { AgentMonitoringMetric } from './metric-card'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MetricCard } from './metric-card'

type TimeRangeKey = 'today' | 'last7days' | 'last30days'

const timeRangeOptions: TimeRangeKey[] = ['today', 'last7days', 'last30days']

const monitoringMetrics: AgentMonitoringMetric[] = [
  {
    id: 'runs',
    titleKey: 'agentDetail.monitoring.metrics.totalRuns.title',
    explanationKey: 'agentDetail.monitoring.metrics.totalRuns.explanation',
    tone: 'green',
    value: 1248,
    change: 12.4,
    icon: 'i-ri-play-circle-line',
    bars: [38, 44, 40, 52, 58, 63, 74, 69, 82, 78, 88, 92],
  },
  {
    id: 'terminals',
    titleKey: 'agentDetail.monitoring.metrics.activeUsers.title',
    explanationKey: 'agentDetail.monitoring.metrics.activeUsers.explanation',
    tone: 'orange',
    value: 286,
    change: 8.7,
    icon: 'i-ri-user-smile-line',
    bars: [32, 36, 48, 44, 52, 60, 56, 64, 70, 76, 72, 84],
  },
  {
    id: 'cost',
    titleKey: 'agentDetail.monitoring.metrics.tokenUsage.title',
    explanationKey: 'agentDetail.monitoring.metrics.tokenUsage.explanation',
    tone: 'blue',
    value: 184.62,
    valueType: 'currency',
    change: 5.2,
    icon: 'i-ri-coins-line',
    bars: [42, 40, 45, 50, 48, 61, 66, 60, 69, 73, 81, 86],
  },
  {
    id: 'interactions',
    titleKey: 'agentDetail.monitoring.metrics.avgInteractions.title',
    explanationKey: 'agentDetail.monitoring.metrics.avgInteractions.explanation',
    tone: 'green',
    value: 4.8,
    valueType: 'decimal',
    unitKey: 'agentDetail.monitoring.metrics.avgInteractions.unit',
    change: 3.9,
    icon: 'i-ri-route-line',
    bars: [45, 48, 43, 55, 59, 57, 64, 68, 71, 69, 76, 80],
  },
]

export function AgentMonitoringPage() {
  const { t } = useTranslation('agentV2')
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('last7days')
  const periodName = t(`agentDetail.monitoring.timeRanges.${timeRange}`)

  return (
    <section
      aria-label={t('agentDetail.sections.monitoring')}
      className="h-full min-w-0 flex-1 overflow-auto bg-components-panel-bg-blur px-4 py-6 sm:px-12"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-4">
          <h2 className="mb-2 system-xl-semibold text-text-primary">
            {t('agentDetail.monitoring.title')}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl system-sm-regular text-text-tertiary">
              {t('agentDetail.monitoring.description')}
            </p>
            <Select
              value={timeRange}
              onValueChange={(nextValue) => {
                if (nextValue)
                  setTimeRange(nextValue as TimeRangeKey)
              }}
            >
              <SelectTrigger
                aria-label={t('agentDetail.monitoring.timeRangeLabel')}
                className="mt-0 w-fit max-w-full min-w-34"
              >
                {periodName}
              </SelectTrigger>
              <SelectContent>
                {timeRangeOptions.map(option => (
                  <SelectItem key={option} value={option}>
                    <SelectItemText>
                      {t(`agentDetail.monitoring.timeRanges.${option}`)}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          {monitoringMetrics.map(metric => (
            <MetricCard
              key={metric.id}
              metric={metric}
              periodName={periodName}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
