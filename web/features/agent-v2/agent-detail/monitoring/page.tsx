'use client'

import type { AgentAccessSource } from '../access/access-sources'
import { Button } from '@langgenius/dify-ui/button'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentAccessSources } from '../access/access-sources'
import { AgentMonitoringChart } from './chart'
import { getAgentMonitoringMetrics } from './mock-data'

type TimeRangeKey = 'today' | 'last7days' | 'last30days'
type SourceFilterValue = 'all' | AgentAccessSource['nameKey']

const queryDateFormat = 'YYYY-MM-DD HH:mm'
const displayDateFormat = 'MMM D'

const timeRangeOptions: Array<{ value: TimeRangeKey, days: number }> = [
  { value: 'today', days: 0 },
  { value: 'last7days', days: 7 },
  { value: 'last30days', days: 30 },
]

const getPeriod = (timeRange: TimeRangeKey) => {
  const option = timeRangeOptions.find(item => item.value === timeRange) ?? timeRangeOptions[0]!
  const end = dayjs().endOf('day')
  const start = option.days === 0
    ? dayjs().startOf('day')
    : dayjs().subtract(option.days, 'day').startOf('day')

  return {
    query: {
      start: start.format(queryDateFormat),
      end: end.format(queryDateFormat),
    },
    dateLabel: `${start.format(displayDateFormat)} - ${end.format(displayDateFormat)}`,
  }
}

const getSourceValue = (source: AgentAccessSource): SourceFilterValue => source.nameKey

export function AgentMonitoringPage() {
  const { t } = useTranslation('agentV2')
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('today')
  const [sourceFilter, setSourceFilter] = useState<SourceFilterValue>(agentAccessSources[0] ? getSourceValue(agentAccessSources[0]) : 'all')
  const selectedTimeRange = timeRangeOptions.find(option => option.value === timeRange) ?? timeRangeOptions[0]!
  const selectedSource = agentAccessSources.find(source => getSourceValue(source) === sourceFilter)
  const period = getPeriod(timeRange)
  const metrics = getAgentMonitoringMetrics(period.query)

  return (
    <section
      aria-label={t('agentDetail.sections.monitoring')}
      className="h-full min-w-0 flex-1 overflow-auto bg-components-panel-bg-blur px-4 py-6 sm:px-12"
    >
      <div className="mx-auto max-w-none">
        <header className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="mr-2 system-xl-semibold text-text-primary">
            {t('agentDetail.monitoring.title')}
          </h2>

          <Select
            value={timeRange}
            onValueChange={(nextValue) => {
              if (nextValue)
                setTimeRange(nextValue as TimeRangeKey)
            }}
          >
            <SelectTrigger
              aria-label={t('agentDetail.monitoring.timeRangeLabel')}
              className="mt-0 w-fit max-w-full min-w-25"
            >
              {t(`agentDetail.monitoring.timeRanges.${selectedTimeRange.value}`)}
            </SelectTrigger>
            <SelectContent>
              {timeRangeOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  <SelectItemText>{t(`agentDetail.monitoring.timeRanges.${option.value}`)}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="secondary"
            className="h-8 gap-2 px-3"
            aria-label={t('agentDetail.monitoring.dateRangeLabel')}
          >
            <span aria-hidden className="i-ri-calendar-line size-4" />
            {period.dateLabel}
          </Button>

          <Select
            value={sourceFilter}
            onValueChange={(nextValue) => {
              if (nextValue)
                setSourceFilter(nextValue as SourceFilterValue)
            }}
          >
            <SelectTrigger
              aria-label={t('agentDetail.monitoring.sourceLabel')}
              className="mt-0 w-fit max-w-full min-w-34"
            >
              <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
                <span aria-hidden className={`${selectedSource?.icon ?? 'i-ri-stack-line'} size-4 shrink-0`} />
                <span className="min-w-0 truncate">
                  {selectedSource ? t(selectedSource.nameKey) : t('agentDetail.monitoring.sources.all')}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent popupClassName="w-61">
              <div className="px-3 pt-2 pb-1 system-2xs-semibold-uppercase text-text-tertiary">
                {t('agentDetail.monitoring.pickSource')}
              </div>
              <SelectItem value="all">
                <SelectItemText>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="i-ri-stack-line size-4 text-text-tertiary" />
                    {t('agentDetail.monitoring.sources.all')}
                  </span>
                </SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
              {agentAccessSources.map(source => (
                <SelectItem key={source.nameKey} value={getSourceValue(source)}>
                  <SelectItemText>
                    <span className="flex items-center gap-2">
                      <span aria-hidden className={`${source.icon} size-4 text-text-accent-light-mode-only`} />
                      {t(source.nameKey)}
                    </span>
                  </SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
          {metrics.map(metric => (
            <AgentMonitoringChart
              key={metric.id}
              titleKey={metric.titleKey}
              explanationKey={metric.explanationKey}
              periodName={t(`agentDetail.monitoring.timeRanges.${selectedTimeRange.value}`)}
              rows={metric.rows}
              chartType={metric.chartType}
              valueKey={metric.valueKey}
              isAvg={metric.isAvg}
              unitKey={metric.unitKey}
              yMax={metric.yMax}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
