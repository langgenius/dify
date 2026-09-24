'use client'

import type { MetricChange } from './overview-format'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import ReactECharts from 'echarts-for-react'
import { useAtomValueRawSync } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { compactNumber, formatDuration, formatMetricChange } from './overview-format'
import { EmptyInline, OverviewErrorInline, Panel, Skeleton } from './overview-panel'
import { buildQueryOutcomesChartOptions } from './query-outcomes-chart-options'
import {
  overviewOutcomesDataAtom,
  overviewOutcomesErrorAtom,
  overviewOutcomesPendingAtom,
  overviewShowEmptyModulesAtom,
  overviewStatsDataAtom,
  overviewStatsPendingAtom,
} from './state'

export function MetricCard({
  change,
  empty,
  help,
  loading,
  title,
  value,
}: {
  change?: MetricChange
  empty: boolean
  help?: string
  loading: boolean
  title: string
  value: string
}) {
  return (
    <Panel
      className={cn(
        'flex h-23 flex-col justify-between border-0 bg-background-section p-4 shadow-none',
      )}
    >
      <div className="flex items-center gap-1 text-text-tertiary">
        <h2 className="system-xs-medium">{title}</h2>
        {help && (
          <Infotip>
            <InfotipTrigger aria-label={help} className="size-4" />
            <InfotipContent className="max-w-[260px]">{help}</InfotipContent>
          </Infotip>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-5.5 w-24" />
      ) : (
        <div className="flex min-w-0 items-end gap-2">
          <span
            className={cn(
              'truncate text-[28px] leading-8.5 font-semibold',
              empty ? 'text-text-quaternary' : 'text-text-primary',
            )}
          >
            {empty ? '—' : value}
          </span>
          {!empty && change && change.direction !== 'neutral' && (
            <span
              className={cn(
                'mb-0.5 flex shrink-0 items-center gap-0.5 system-xs-medium',
                change.direction === 'increase' ? 'text-text-success' : 'text-text-warning',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-3',
                  change.direction === 'increase'
                    ? 'i-ri-arrow-up-s-fill'
                    : 'i-ri-arrow-down-s-fill',
                )}
              />
              {change.label}
            </span>
          )}
        </div>
      )}
    </Panel>
  )
}

export function OverviewMetrics() {
  const empty = useAtomValueRawSync(overviewShowEmptyModulesAtom)
  const loading = useAtomValueRawSync(overviewStatsPendingAtom)
  const stats = useAtomValueRawSync(overviewStatsDataAtom)
  const { i18n, t } = useTranslation(['knowledgeOverview'])
  const percentFormat = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 0,
    style: 'percent',
  })

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['overview.queries'], { ns: 'knowledgeOverview' })}
        help={t(($) => $['overview.queriesHelp'], { ns: 'knowledgeOverview' })}
        value={stats ? compactNumber(stats.queries.value, i18n.language) : '—'}
        change={
          stats
            ? formatMetricChange(
                stats.queries.change_rate === null ? null : stats.queries.change_rate * 100,
                i18n.language,
              )
            : undefined
        }
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['overview.answerRate'], { ns: 'knowledgeOverview' })}
        help={t(($) => $['overview.answerRateHelp'], { ns: 'knowledgeOverview' })}
        value={stats ? percentFormat.format(stats.answer_rate.value) : '—'}
        change={
          stats
            ? formatMetricChange(stats.answer_rate.change_percentage_points, i18n.language, 'pp')
            : undefined
        }
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['overview.documents'], { ns: 'knowledgeOverview' })}
        value={stats ? compactNumber(stats.documents, i18n.language) : '—'}
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['overview.linkedApps'], { ns: 'knowledgeOverview' })}
        value={stats ? compactNumber(stats.linked_apps, i18n.language) : '—'}
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['overview.freshness'], { ns: 'knowledgeOverview' })}
        help={t(($) => $['overview.freshnessHelp'], { ns: 'knowledgeOverview' })}
        value={formatDuration(stats?.freshness_seconds, i18n.language)}
      />
    </div>
  )
}

export function QueryOutcomesChart() {
  const outcomes = useAtomValueRawSync(overviewOutcomesDataAtom)
  const empty = useAtomValueRawSync(overviewShowEmptyModulesAtom)
  const error = useAtomValueRawSync(overviewOutcomesErrorAtom)
  const loading = useAtomValueRawSync(overviewOutcomesPendingAtom)
  const buckets = outcomes?.buckets
  const { t, i18n } = useTranslation(['knowledgeSpace', 'knowledgeOverview'])
  const chartOptions = useMemo(
    () =>
      buildQueryOutcomesChartOptions({
        buckets: buckets ?? [],
        labels: {
          answered: t(($) => $['overview.answered'], { ns: 'knowledgeOverview' }),
          lowConfidence: t(($) => $['overview.lowConfidence'], { ns: 'knowledgeOverview' }),
          noEvidence: t(($) => $['overview.noEvidence'], { ns: 'knowledgeOverview' }),
        },
        locale: i18n.language,
      }),
    [buckets, i18n.language, t],
  )

  if (error)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <div className="flex h-6 items-center">
          <h2 className="system-xl-medium text-text-secondary">
            {t(($) => $['overview.queryOutcomes'], { ns: 'knowledgeOverview' })}
          </h2>
        </div>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <OverviewErrorInline />
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <div className="flex h-6 items-center">
          <h2 className="system-xl-medium text-text-secondary">
            {t(($) => $['overview.queryOutcomes'], { ns: 'knowledgeOverview' })}
            <Infotip>
              <InfotipTrigger
                aria-label={t(($) => $['overview.answerRateHelp'], { ns: 'knowledgeOverview' })}
                className="ml-1 inline-flex size-4 align-middle"
              />
              <InfotipContent className="max-w-[260px]">
                {t(($) => $['overview.answerRateHelp'], { ns: 'knowledgeOverview' })}
              </InfotipContent>
            </Infotip>
          </h2>
        </div>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <EmptyInline
            icon="i-ri-time-line"
            title={t(($) => $['overview.noQueryData'], { ns: 'knowledgeOverview' })}
            description={t(($) => $['overview.noQueryDataDescription'], {
              ns: 'knowledgeOverview',
            })}
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex h-93.25 min-w-0 flex-col gap-2 pt-6">
      <div className="flex h-6 items-center">
        <h2 className="system-xl-medium text-text-secondary">
          {t(($) => $['overview.queryOutcomes'], { ns: 'knowledgeOverview' })}
          <Infotip>
            <InfotipTrigger
              aria-label={t(($) => $['overview.answerRateHelp'], { ns: 'knowledgeOverview' })}
              className="ml-1 inline-flex size-4 align-middle"
            />
            <InfotipContent className="max-w-[260px]">
              {t(($) => $['overview.answerRateHelp'], { ns: 'knowledgeOverview' })}
            </InfotipContent>
          </Infotip>
        </h2>
      </div>
      <Panel className="flex h-79.25 flex-col overflow-hidden border border-divider-subtle p-4 shadow-none">
        {loading ? (
          <div className="space-y-6 pt-2">
            {[
              ['outcome-1', 100],
              ['outcome-2', 100],
              ['outcome-3', 100],
              ['outcome-4', 100],
              ['outcome-5', 55],
            ].map(([key, width]) => (
              <Skeleton key={key} className="h-3" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : buckets?.length ? (
          <>
            <p className="sr-only">
              {t(($) => $['overview.queryOutcomes'], { ns: 'knowledgeOverview' })}: {buckets.length}
            </p>
            <ReactECharts
              option={chartOptions}
              opts={{ renderer: 'svg' }}
              style={{ height: 285, width: '100%' }}
            />
          </>
        ) : (
          <EmptyInline
            icon="i-ri-line-chart-line"
            title={t(($) => $['overview.noActivity'], { ns: 'knowledgeOverview' })}
            description={t(($) => $['overview.noActivityDescription'], { ns: 'knowledgeOverview' })}
          />
        )}
      </Panel>
    </section>
  )
}
