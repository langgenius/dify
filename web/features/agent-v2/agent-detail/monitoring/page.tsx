'use client'

import type { AgentLogSourceResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { AgentMonitoringChart } from './chart'
import { getAgentMonitoringMetrics } from './metrics'
import { AgentMonitoringTimeRangePicker } from './time-range-picker'

type SourceFilterValue = 'all' | AgentLogSourceResponse['id']
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

export function AgentMonitoringPage({
  agentId,
}: AgentMonitoringPageProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const docLink = useDocLink()
  const [period, setPeriod] = useState(() => ({
    name: t('agentDetail.monitoring.timeRanges.today'),
    query: getDefaultPeriodQuery(),
  }))
  const [sourceFilter, setSourceFilter] = useState<SourceFilterValue>('all')
  const logSourcesQuery = useQuery(consoleQuery.agent.byAgentId.logSources.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const statisticsQuery = useQuery({
    ...consoleQuery.agent.byAgentId.statistics.summary.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
        query: {
          ...period.query,
          ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
        },
      },
    }),
    placeholderData: keepPreviousData,
  })
  const sources = (logSourcesQuery.data?.groups ?? []).flatMap(group => group.sources ?? [])
  const sourceItems = [
    {
      value: 'all' as const,
      name: t('agentDetail.monitoring.sources.all'),
      triggerName: t('agentDetail.monitoring.sourceTrigger', {
        name: t('agentDetail.monitoring.sources.all'),
      }),
    },
    ...sources.map(source => ({
      value: source.id,
      name: source.app_name,
      triggerName: t('agentDetail.monitoring.sourceTrigger', {
        name: source.app_name,
      }),
    })),
  ]
  const metrics = getAgentMonitoringMetrics(statisticsQuery.data, period.query)
  const shouldShowInitialSkeleton = statisticsQuery.isPending && !statisticsQuery.data
  const shouldShowError = statisticsQuery.isError && !statisticsQuery.data

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
        {shouldShowInitialSkeleton && <AgentMonitoringSkeletonGrid />}
        {shouldShowError && (
          <AgentMonitoringState>
            <div className="flex items-center justify-center gap-2">
              <span>{t('agentDetail.monitoring.loadFailed')}</span>
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  void statisticsQuery.refetch()
                }}
              >
                {tCommon('operation.retry')}
              </Button>
            </div>
          </AgentMonitoringState>
        )}
        {!shouldShowInitialSkeleton && !shouldShowError && (
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
                yMaxWhenEmpty={metric.yMaxWhenEmpty}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}

function AgentMonitoringState({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex h-[316px] items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-6 py-8 text-center system-sm-regular text-text-tertiary">
      {children}
    </div>
  )
}

function AgentMonitoringSkeletonGrid() {
  return (
    <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
      {Array.from({ length: 6 }, (_, index) => (
        <article
          key={index}
          aria-hidden="true"
          className="flex h-[316px] w-full min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg"
        >
          <div className="flex h-11 items-end px-6 pb-1">
            <div className="h-4 w-40 rounded-sm bg-text-quaternary opacity-20" />
          </div>
          <div className="flex h-8 items-start px-6 py-1">
            <div className="h-6 w-24 rounded-sm bg-text-quaternary opacity-20" />
          </div>
          <div className="h-60 px-6 pb-4">
            <div className="h-full rounded-md bg-text-quaternary opacity-10" />
          </div>
        </article>
      ))}
    </div>
  )
}
