'use client'

import type { AgentLogSourceResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type { AgentMonitoringPeriod } from './time-range-picker'
import { Button } from '@langgenius/dify-ui/button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { consoleQuery } from '@/service/console'
import { AgentDetailSectionSurface } from '../section-surface'
import { AgentMonitoringChart } from './chart'
import { getAgentMonitoringMetrics } from './metrics'
import { AgentMonitoringTimeRangePicker } from './time-range-picker'
import { AgentTracingConfiguration } from './tracing-configuration'

type SourceFilterValue = 'all' | AgentLogSourceResponse['id']
type SourceFilterItem = {
  value: SourceFilterValue
  name: string
}
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

export function AgentMonitoringPage({ agentId }: AgentMonitoringPageProps) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const [period, setPeriod] = useState<AgentMonitoringPeriod>(() => ({
    name: t(($) => $['agentDetail.monitoring.timeRanges.today']),
    query: getDefaultPeriodQuery(),
  }))
  const [sourceFilter, setSourceFilter] = useState<SourceFilterValue>('all')
  const logSourcesQuery = useQuery(
    consoleQuery.agent.byAgentId.logSources.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
  )
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
  const sources = (logSourcesQuery.data?.groups ?? []).flatMap((group) => group.sources ?? [])
  const sourceItems: SourceFilterItem[] = [
    {
      value: 'all' as const,
      name: t(($) => $['agentDetail.monitoring.sources.all']),
    },
    ...sources.map((source) => ({
      value: source.id,
      name: source.app_name,
    })),
  ]
  const metrics = getAgentMonitoringMetrics(statisticsQuery.data, period.query)
  const shouldShowInitialSkeleton = statisticsQuery.isPending && !statisticsQuery.data
  const shouldShowError = statisticsQuery.isError && !statisticsQuery.data

  return (
    <AgentDetailSectionSurface label={t(($) => $['agentDetail.sections.monitoring'])}>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <ScrollAreaViewport>
          <ScrollAreaContent className="pb-3">
            <header className="px-6 pt-3 pb-2">
              <div className="min-w-0">
                <h2 className="system-xl-semibold text-text-primary">
                  {t(($) => $['agentDetail.monitoring.title'])}
                </h2>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['agentDetail.monitoring.description'])}
                </p>
              </div>

              <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <AgentMonitoringTimeRangePicker value={period} onChange={setPeriod} />

                  <Chip<SourceFilterValue>
                    showLeftIcon={false}
                    value={sourceFilter}
                    items={sourceItems}
                    label={t(($) => $['agentDetail.metadata.sourceLabel'])}
                    onSelect={(item) => {
                      setSourceFilter(item.value)
                    }}
                    onClear={() => {
                      setSourceFilter('all')
                    }}
                  />
                </div>
                <AgentTracingConfiguration agentId={agentId} />
              </div>
            </header>
            <div className="px-6 pt-2">
              {shouldShowInitialSkeleton && <AgentMonitoringSkeletonGrid />}
              {shouldShowError && (
                <AgentMonitoringState>
                  <div className="flex items-center justify-center gap-2">
                    <span role="alert">{t(($) => $['agentDetail.monitoring.loadFailed'])}</span>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => {
                        void statisticsQuery.refetch()
                      }}
                    >
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                </AgentMonitoringState>
              )}
              {!shouldShowInitialSkeleton && !shouldShowError && (
                <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
                  {metrics.map((metric) => (
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
            </div>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>
    </AgentDetailSectionSurface>
  )
}

function AgentMonitoringState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-79 items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-6 py-8 text-center system-sm-regular text-text-tertiary">
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
          className="flex h-79 w-full min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg"
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
