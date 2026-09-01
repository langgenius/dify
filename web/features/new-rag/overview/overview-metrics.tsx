'use client'

import { cn } from '@langgenius/dify-ui/cn'
import ReactECharts from 'echarts-for-react'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { changeLabel, compactNumber, formatDuration } from './overview-format'
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
  change?: string
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
          <Infotip
            aria-label={help}
            className="size-4"
            popupClassName="max-w-[260px] border-0 bg-text-primary text-text-primary-on-surface"
          >
            {help}
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
          {!empty && change && (
            <span
              className={cn(
                'mb-0.5 flex shrink-0 items-center gap-0.5 system-xs-medium',
                change.startsWith('+')
                  ? 'text-text-success'
                  : change.startsWith('-')
                    ? 'text-text-warning'
                    : 'text-text-quaternary',
              )}
            >
              {change !== '—' && (
                <span
                  aria-hidden
                  className={cn(
                    'size-3',
                    change.startsWith('+') ? 'i-ri-arrow-up-s-fill' : 'i-ri-arrow-down-s-fill',
                  )}
                />
              )}
              {change}
            </span>
          )}
        </div>
      )}
    </Panel>
  )
}

export function OverviewMetrics() {
  const empty = useAtomValue(overviewShowEmptyModulesAtom)
  const loading = useAtomValue(overviewStatsPendingAtom)
  const stats = useAtomValue(overviewStatsDataAtom)
  const { t } = useTranslation('dataset')

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['newKnowledge.overview.queries'])}
        help={t(($) => $['newKnowledge.overview.queriesHelp'])}
        value={stats ? compactNumber(stats.queries.value) : '—'}
        change={
          stats
            ? changeLabel(
                stats.queries.change_rate === null ? null : stats.queries.change_rate * 100,
              )
            : undefined
        }
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['newKnowledge.overview.answerRate'])}
        help={t(($) => $['newKnowledge.overview.answerRateHelp'])}
        value={stats ? `${Math.round(stats.answer_rate.value * 100)}%` : '—'}
        change={stats ? changeLabel(stats.answer_rate.change_percentage_points, 'pp') : undefined}
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['newKnowledge.overview.documents'])}
        value={stats ? compactNumber(stats.documents) : '—'}
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['newKnowledge.overview.linkedApps'])}
        value={stats ? compactNumber(stats.linked_apps) : '—'}
      />
      <MetricCard
        empty={empty}
        loading={loading}
        title={t(($) => $['newKnowledge.overview.freshness'])}
        help={t(($) => $['newKnowledge.overview.freshnessHelp'])}
        value={formatDuration(stats?.freshness_seconds)}
      />
    </div>
  )
}

export function QueryOutcomesChart() {
  const outcomes = useAtomValue(overviewOutcomesDataAtom)
  const empty = useAtomValue(overviewShowEmptyModulesAtom)
  const error = useAtomValue(overviewOutcomesErrorAtom)
  const loading = useAtomValue(overviewOutcomesPendingAtom)
  const buckets = outcomes?.buckets
  const { t, i18n } = useTranslation('dataset')
  const chartOptions = useMemo(
    () =>
      buildQueryOutcomesChartOptions({
        buckets: buckets ?? [],
        labels: {
          answered: t(($) => $['newKnowledge.overview.answered']),
          lowConfidence: t(($) => $['newKnowledge.overview.lowConfidence']),
          noEvidence: t(($) => $['newKnowledge.overview.noEvidence']),
        },
        locale: i18n.language,
      }),
    [buckets, i18n.language, t],
  )

  if (error)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <div className="flex h-6 items-center">
          <h2 className="system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['newKnowledge.overview.queryOutcomes'])}
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
          <h2 className="system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['newKnowledge.overview.queryOutcomes'])}
            <Infotip
              aria-label={t(($) => $['newKnowledge.overview.answerRateHelp'])}
              className="ml-1 inline-flex size-4 align-middle"
              popupClassName="max-w-[260px] border-0 bg-text-primary text-text-primary-on-surface"
            >
              {t(($) => $['newKnowledge.overview.answerRateHelp'])}
            </Infotip>
          </h2>
        </div>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <EmptyInline
            icon="i-ri-time-line"
            title={t(($) => $['newKnowledge.overview.noQueryData'])}
            description={t(($) => $['newKnowledge.overview.noQueryDataDescription'])}
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex h-93.25 min-w-0 flex-col gap-2 pt-6">
      <div className="flex h-6 items-center">
        <h2 className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['newKnowledge.overview.queryOutcomes'])}
          <Infotip
            aria-label={t(($) => $['newKnowledge.overview.answerRateHelp'])}
            className="ml-1 inline-flex size-4 align-middle"
            popupClassName="max-w-[260px] border-0 bg-text-primary text-text-primary-on-surface"
          >
            {t(($) => $['newKnowledge.overview.answerRateHelp'])}
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
              {t(($) => $['newKnowledge.overview.queryOutcomes'])}: {buckets.length}
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
            title={t(($) => $['newKnowledge.overview.noActivity'])}
            description={t(($) => $['newKnowledge.overview.noActivityDescription'])}
          />
        )}
      </Panel>
    </section>
  )
}
