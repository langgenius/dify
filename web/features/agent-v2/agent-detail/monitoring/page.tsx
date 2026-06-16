'use client'

import type { AgentAccessSource } from '../access/access-sources'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { getAgentAccessSources } from '../access/access-sources'
import { AgentMonitoringChart } from './chart'
import { getAgentMonitoringMetrics } from './mock-data'
import { AgentMonitoringTimeRangePicker } from './time-range-picker'

type SourceFilterValue = 'all' | AgentAccessSource['id']
type AgentMonitoringPageProps = {
  agentId: string
}

const queryDateFormat = 'YYYY-MM-DD HH:mm'

const getDefaultPeriodQuery = () => {
  const start = dayjs().startOf('day')
  const end = dayjs().endOf('day')

  return {
    start: start.format(queryDateFormat),
    end: end.format(queryDateFormat),
  }
}

const getSourceValue = (source: AgentAccessSource): SourceFilterValue => source.id

export function AgentMonitoringPage({
  agentId,
}: AgentMonitoringPageProps) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const [period, setPeriod] = useState(() => ({
    name: t('agentDetail.monitoring.timeRanges.today'),
    query: getDefaultPeriodQuery(),
  }))
  const [sourceFilter, setSourceFilter] = useState<SourceFilterValue>('all')
  const agentQuery = useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const accessSources = getAgentAccessSources(agentQuery.data)
  const sourceItems = [
    {
      value: 'all' as const,
      name: t('agentDetail.monitoring.sources.all'),
      triggerName: t('agentDetail.monitoring.sourceTrigger', {
        name: t('agentDetail.monitoring.sources.all'),
      }),
    },
    ...accessSources.map(source => ({
      value: getSourceValue(source),
      name: t(source.nameKey),
      triggerName: t('agentDetail.monitoring.sourceTrigger', {
        name: t(source.nameKey),
      }),
    })),
  ]
  const metrics = getAgentMonitoringMetrics(period.query)

  return (
    <section
      aria-label={t('agentDetail.sections.monitoring')}
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-components-panel-bg-blur"
    >
      <header className="h-26.5 shrink-0 px-6 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t('agentDetail.monitoring.title')}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>{t('agentDetail.monitoring.description')}</span>
            <a
              href={docLink('/use-dify/monitor/logs')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {t('agentDetail.monitoring.learnMore')}
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
          </p>
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <AgentMonitoringTimeRangePicker
            value={period}
            onChange={setPeriod}
          />

          <Chip
            showLeftIcon={false}
            className="min-w-53"
            panelClassName="w-61"
            value={sourceFilter}
            items={sourceItems}
            onSelect={(item) => {
              setSourceFilter(item.value)
            }}
            onClear={() => {
              setSourceFilter('all')
            }}
          />
        </div>
      </header>

      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden"
        slotClassNames={{
          content: 'px-6 pt-2 pb-3',
        }}
      >
        <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
          {metrics.map(metric => (
            <AgentMonitoringChart
              key={metric.id}
              titleKey={metric.titleKey}
              explanationKey={metric.explanationKey}
              summaryValue={metric.summaryValue}
              rows={metric.rows}
              chartType={metric.chartType}
              valueKey={metric.valueKey}
              unitKey={metric.unitKey}
              yMax={metric.yMax}
            />
          ))}
        </div>
      </ScrollArea>
    </section>
  )
}
