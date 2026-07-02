'use client'

import type { AgentLogSourceResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { AgentDetailSectionSurface } from '../section-surface'
import { AgentMonitoringChart } from './chart'
import { getAgentMonitoringMetrics } from './metrics'
import { AgentMonitoringTimeRangePicker } from './time-range-picker'

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
  const sourceItems: SourceFilterItem[] = [
    {
      value: 'all' as const,
      name: t('agentDetail.monitoring.sources.all'),
    },
    ...sources.map(source => ({
      value: source.id,
      name: source.app_name,
    })),
  ]
  const metrics = getAgentMonitoringMetrics(statisticsQuery.data, period.query)
  const shouldShowInitialSkeleton = statisticsQuery.isPending && !statisticsQuery.data
  const shouldShowError = statisticsQuery.isError && !statisticsQuery.data

  return (
    <AgentDetailSectionSurface label={t('agentDetail.sections.monitoring')}>
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

          <AgentMonitoringSourceFilter
            value={sourceFilter}
            items={sourceItems}
            label={t('agentDetail.metadata.sourceLabel')}
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
    </AgentDetailSectionSurface>
  )
}

function AgentMonitoringSourceFilter({
  value,
  items,
  label,
  onSelect,
  onClear,
}: {
  value: SourceFilterValue
  items: SourceFilterItem[]
  label: string
  onSelect: (item: SourceFilterItem) => void
  onClear: () => void
}) {
  const { t } = useTranslation('common')
  const selectedItem = items.find(item => Object.is(item.value, value))
  const selectedName = selectedItem?.name ?? ''
  const triggerLabel = selectedName ? `${label} ${selectedName}` : label
  const clearLabel = selectedName
    ? `${t('operation.clear')} ${triggerLabel}`
    : t('operation.clear')

  return (
    <Select
      value={selectedItem?.value ?? null}
      itemToStringLabel={(itemValue: SourceFilterValue) => items.find(item => Object.is(item.value, itemValue))?.name ?? ''}
      itemToStringValue={itemValue => String(itemValue)}
      onValueChange={(nextValue) => {
        if (nextValue === null)
          return
        const selected = items.find(item => Object.is(item.value, nextValue))
        if (selected)
          onSelect(selected)
      }}
    >
      <div className="relative w-fit max-w-full">
        <SelectTrigger
          aria-label={triggerLabel}
          className="h-auto min-h-8 w-fit max-w-full min-w-53 cursor-pointer items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 py-1 pr-6 shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover! focus-visible:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:border-components-button-secondary-border-hover! data-popup-open:bg-components-button-secondary-bg-hover! data-popup-open:hover:border-components-button-secondary-border-hover data-popup-open:hover:bg-components-button-secondary-bg-hover! [&>*:last-child]:hidden"
        >
          <span className="flex min-w-0 grow items-center gap-1 text-left">
            <span className="flex min-w-0 grow items-center gap-1 px-1">
              <span className="shrink-0 system-sm-regular text-text-tertiary">
                {label}
              </span>
              <span className="truncate system-sm-medium text-text-secondary">
                {selectedName}
              </span>
            </span>
          </span>
        </SelectTrigger>
        <button
          type="button"
          aria-label={clearLabel}
          className="group/clear absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer touch-manipulation items-center justify-center rounded-md border-none bg-transparent p-0 outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          onClick={onClear}
        >
          <span aria-hidden className="i-ri-close-circle-fill block size-3.5 text-text-quaternary group-hover/clear:text-text-tertiary" />
        </button>
        <SelectContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="relative w-61 rounded-xl border-[0.5px] bg-components-panel-bg-blur p-0 text-sm text-text-secondary shadow-lg outline-hidden backdrop-blur-[5px] focus:outline-hidden focus-visible:outline-hidden"
          listClassName="max-h-72 p-1"
        >
          {items.map(item => (
            <SelectItem
              key={item.value}
              value={item.value}
            >
              <SelectItemText title={item.name}>{item.name}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
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
