'use client'

import type {
  KnowledgeFsBackgroundTaskResponse,
  KnowledgeFsOverviewHealthResponse,
  KnowledgeFsOverviewQueryOutcomeBucketResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { EChartsOption } from 'echarts'
import type { CSSProperties } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import ReactECharts from 'echarts-for-react'
import { useAtomValue } from 'jotai'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysAtom,
} from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom } from '@/context/system-features-state'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import {
  newKnowledgeAddSourcePath,
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeQualityPath,
  newKnowledgeRetrievalTestPath,
} from '../routes'

type OverviewWindow = '24h' | '7d' | '30d'
type ActivityRange = 'today' | '7d' | '30d' | '90d' | 'all'

const WINDOWS: OverviewWindow[] = ['24h', '7d', '30d']
const QUERY_OUTCOMES_WINDOW: OverviewWindow = '7d'
const ACTIVE_TASK_STATES = new Set<KnowledgeFsBackgroundTaskResponse['state']>([
  'queued',
  'running',
])
const TASK_PAGE_SIZE = 20
const OVERVIEW_REFRESH_INTERVAL = 2000
const overviewWindowParser = parseAsStringLiteral(WINDOWS)
  .withDefault('24h')
  .withOptions({ history: 'push' })

function isFirstSourceTask(task: KnowledgeFsBackgroundTaskResponse) {
  return (
    task.operation === 'document_processing' ||
    task.operation === 'document_upload' ||
    task.operation.includes('import')
  )
}

function compactNumber(value: number) {
  return Intl.NumberFormat().format(value)
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function changeLabel(value: number | null, suffix = '%') {
  if (value === null || value === 0) return '—'
  return `${value > 0 ? '+' : ''}${Math.round(value)}${suffix}`
}

function overviewRefreshInterval({
  generatedAt,
  hasActiveTasks,
  latestTaskUpdatedAt,
}: {
  generatedAt?: string
  hasActiveTasks: boolean
  latestTaskUpdatedAt?: number
}) {
  if (hasActiveTasks) return OVERVIEW_REFRESH_INTERVAL
  if (latestTaskUpdatedAt === undefined) return false

  const generatedAtTimestamp = generatedAt ? Date.parse(generatedAt) : Number.NaN
  return Number.isFinite(generatedAtTimestamp) && generatedAtTimestamp >= latestTaskUpdatedAt
    ? false
    : OVERVIEW_REFRESH_INTERVAL
}

function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block animate-pulse rounded bg-util-colors-gray-gray-200 motion-reduce:animate-none',
        className,
      )}
      style={style}
    />
  )
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs',
        className,
      )}
    >
      {children}
    </section>
  )
}

function MetricCard({
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

function QueryOutcomesChart({
  buckets,
  empty,
  error,
  loading,
}: {
  buckets: KnowledgeFsOverviewQueryOutcomeBucketResponse[]
  empty: boolean
  error: boolean
  loading: boolean
}) {
  const { t, i18n } = useTranslation('dataset')
  const chartOptions = useMemo<EChartsOption>(() => {
    const dailyBuckets =
      buckets.length > 1 &&
      new Date(buckets[1]!.start_at).getTime() - new Date(buckets[0]!.start_at).getTime() >=
        12 * 60 * 60 * 1000
    const label = (date: string) =>
      Intl.DateTimeFormat(i18n.language, {
        day: 'numeric',
        hour: dailyBuckets ? undefined : 'numeric',
        month: dailyBuckets ? 'short' : undefined,
      }).format(new Date(date))

    return {
      animationDuration: 250,
      color: ['#0033ff', '#bdb4fe', '#f79009'],
      grid: { bottom: 18, containLabel: true, left: 0, right: 24, top: 42 },
      legend: {
        icon: 'circle',
        itemHeight: 7,
        itemWidth: 7,
        right: 0,
        textStyle: { color: '#6b7280', fontSize: 11 },
        top: 0,
      },
      series: [
        {
          areaStyle: { opacity: 0.08 },
          data: buckets.map((bucket) => bucket.answered),
          name: t(($) => $['newKnowledge.overview.answered']),
          showSymbol: true,
          smooth: true,
          symbolSize: 6,
          type: 'line',
        },
        {
          data: buckets.map((bucket) => bucket.low_confidence),
          name: t(($) => $['newKnowledge.overview.lowConfidence']),
          showSymbol: true,
          smooth: true,
          symbolSize: 5,
          type: 'line',
        },
        {
          data: buckets.map((bucket) => bucket.no_evidence),
          name: t(($) => $['newKnowledge.overview.noEvidence']),
          showSymbol: true,
          smooth: true,
          symbolSize: 5,
          type: 'line',
        },
      ],
      tooltip: { trigger: 'axis' },
      xAxis: {
        axisLabel: { color: '#9ca3af', fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisTick: { show: false },
        boundaryGap: false,
        data: buckets.map((bucket) => label(bucket.start_at)),
        type: 'category',
      },
      yAxis: {
        axisLabel: { color: '#9ca3af', fontSize: 10 },
        axisLine: { show: false },
        interval: 50,
        max: (value) => Math.max(250, Math.ceil(value.max / 50) * 50),
        splitLine: { lineStyle: { color: '#eef0f3', type: 'dashed' } },
        type: 'value',
      },
    }
  }, [buckets, i18n.language, t])

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
        ) : buckets.length ? (
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

function EmptyInline({
  description,
  icon,
  positive = false,
  title,
}: {
  description: string
  icon: string
  positive?: boolean
  title: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <span
        aria-hidden
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          positive
            ? 'bg-state-success-hover text-text-success'
            : 'bg-background-section text-text-tertiary',
        )}
      >
        <span className={cn('size-5', icon)} />
      </span>
      <div className="flex flex-col items-center gap-1">
        <p className="system-md-medium text-text-primary">{title}</p>
        <p className="max-w-100 body-xs-regular text-text-tertiary">{description}</p>
      </div>
    </div>
  )
}

function OverviewErrorInline() {
  const { t } = useTranslation('dataset')

  return (
    <EmptyInline
      icon="i-ri-error-warning-line"
      title={t(($) => $['newKnowledge.detailErrorTitle'])}
      description={t(($) => $['newKnowledge.detailErrorDescription'])}
    />
  )
}

function HealthPanel({
  empty,
  error,
  health,
  knowledgeSpaceId,
  loading,
}: {
  empty: boolean
  error: boolean
  health?: KnowledgeFsOverviewHealthResponse
  knowledgeSpaceId: string
  loading: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [issuePage, setIssuePage] = useState(0)
  const issueOrder = [
    'query_availability',
    'ingestion',
    'index',
    'profile_publication',
    'source_freshness',
    'worker_readiness',
  ]
  const issues = health
    ? Object.entries(health.components)
        .filter(([, component]) => component.state !== 'healthy')
        .sort(([a], [b]) => issueOrder.indexOf(a) - issueOrder.indexOf(b))
    : []
  const issuePageCount = Math.max(1, Math.ceil(issues.length / 5))
  const activeIssuePage = Math.min(issuePage, issuePageCount - 1)
  const visibleIssues = issues.slice(activeIssuePage * 5, activeIssuePage * 5 + 5)
  const issueLabel = (name: string) => {
    if (name === 'query_availability') return t(($) => $['newKnowledge.overview.queryOutcomes'])
    if (name === 'ingestion')
      return t(($) => $['newKnowledge.overview.operation.document_processing'])
    if (name === 'index') return t(($) => $['newKnowledge.overview.indexCoverage'])
    if (name === 'profile_publication') return t(($) => $['newKnowledge.retrievalTest.title'])
    if (name === 'source_freshness') return t(($) => $['newKnowledge.overview.freshness'])
    return t(($) => $['newKnowledge.backgroundTasks'])
  }
  const issueAction = (name: string) => {
    if (name === 'query_availability')
      return {
        href: newKnowledgeRetrievalTestPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.reviewConflict']),
      }
    if (name === 'ingestion')
      return {
        href: newKnowledgeDetailPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.fixSource']),
      }
    if (name === 'index')
      return {
        href: newKnowledgeDocumentsPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.rebuildIndex']),
      }
    if (name === 'profile_publication')
      return {
        href: newKnowledgeQualityPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.updateEvidence']),
      }
    return {
      href: newKnowledgeDocumentsPath(knowledgeSpaceId),
      label: t(($) => $['newKnowledge.overview.viewDocuments']),
    }
  }

  if (error)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.needsAttention'])}
        </h2>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <OverviewErrorInline />
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.needsAttention'])}
        </h2>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <EmptyInline
            positive
            icon="i-ri-thumb-up-line"
            title={t(($) => $['newKnowledge.overview.noIssues'])}
            description={t(($) => $['newKnowledge.overview.noIssuesDescription'])}
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex h-93.25 min-w-0 flex-col gap-2 pt-6">
      <div className="flex h-6 items-center">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.needsAttention'])}
        </h2>
      </div>
      <Panel className="flex h-79.25 flex-col overflow-hidden border border-divider-subtle px-4 py-3 shadow-none">
        {loading ? (
          <div className="space-y-6.75 pt-4">
            {[
              ['attention-1', 100],
              ['attention-2', 100],
              ['attention-3', 100],
              ['attention-4', 100],
              ['attention-5', 86],
            ].map(([key, width]) => (
              <Skeleton key={key} className="h-3.5" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : issues.length ? (
          <>
            <ul className="min-h-0 flex-1 overflow-hidden">
              {visibleIssues.map(([name]) => (
                <li key={name} className="flex h-12 min-w-0 items-center gap-4">
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-2 py-0.5 system-xs-medium',
                      name === 'query_availability'
                        ? 'bg-state-destructive-hover text-text-destructive'
                        : name === 'ingestion'
                          ? 'bg-state-warning-hover text-text-warning'
                          : 'bg-background-section text-text-tertiary',
                    )}
                  >
                    {name === 'query_availability'
                      ? t(($) => $['newKnowledge.overview.blocker'])
                      : name === 'ingestion'
                        ? t(($) => $['newKnowledge.overview.serious'])
                        : t(($) => $['newKnowledge.overview.review'])}
                  </span>
                  <p className="min-w-0 flex-1 truncate system-sm-regular text-text-primary">
                    {issueLabel(name)}
                  </p>
                  <Button
                    render={<Link href={issueAction(name).href} />}
                    nativeButton={false}
                    size="small"
                    tone={name === 'query_availability' ? 'destructive' : 'default'}
                    variant={name === 'query_availability' ? 'primary' : 'secondary'}
                    className={cn(
                      name === 'query_availability' &&
                        'border-[#ff4d14] bg-[#ff4d14] hover:border-[#e64210] hover:bg-[#e64210]',
                    )}
                  >
                    {issueAction(name).label}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex h-13.25 shrink-0 items-end justify-end border-t border-divider-subtle pb-1">
              <div className="flex h-8 items-center rounded-lg border border-divider-subtle p-0.5">
                <button
                  type="button"
                  aria-label={tCommon(($) => $['pagination.previous'])}
                  className="flex size-7 items-center justify-center rounded-md text-text-quaternary"
                  disabled={activeIssuePage === 0}
                  onClick={() => setIssuePage(Math.max(0, activeIssuePage - 1))}
                >
                  <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
                </button>
                <span className="px-2 system-xs-medium text-text-secondary">
                  {activeIssuePage + 1} / {issuePageCount}
                </span>
                <button
                  type="button"
                  aria-label={tCommon(($) => $['pagination.next'])}
                  className="flex size-7 items-center justify-center rounded-md text-text-quaternary"
                  disabled={activeIssuePage >= issuePageCount - 1}
                  onClick={() => setIssuePage(Math.min(issuePageCount - 1, activeIssuePage + 1))}
                >
                  <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyInline
            icon="i-ri-checkbox-circle-line"
            title={t(($) => $['newKnowledge.overview.noIssues'])}
            description={t(($) => $['newKnowledge.overview.noIssuesDescription'])}
          />
        )}
      </Panel>
    </section>
  )
}

function operationLabel(
  task: KnowledgeFsBackgroundTaskResponse,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
) {
  return t(($) => $[`newKnowledge.overview.operation.${task.operation}`])
}

function activityLabel(
  task: KnowledgeFsBackgroundTaskResponse,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
) {
  const operation = operationLabel(task, t)
  if (task.state === 'completed')
    return t(($) => $['newKnowledge.overview.activityCompleted'], { operation })
  if (task.state === 'failed')
    return t(($) => $['newKnowledge.overview.activityFailed'], { operation })
  if (task.state === 'canceled')
    return t(($) => $['newKnowledge.overview.activityCanceled'], { operation })
  if (task.state === 'queued')
    return t(($) => $['newKnowledge.overview.activityQueued'], { operation })
  return t(($) => $['newKnowledge.overview.activityRunning'], { operation })
}

function RecentActivity({
  empty,
  error,
  indexing = false,
  loading,
  onOpenAll,
  onRetry,
  retrying,
  tasks,
}: {
  empty: boolean
  error: boolean
  indexing?: boolean
  loading: boolean
  onOpenAll: () => void
  onRetry: () => void
  retrying: boolean
  tasks: KnowledgeFsBackgroundTaskResponse[]
}) {
  const { t, i18n } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const formatWhen = (value: string) => {
    const timestamp = new Date(value)
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 60_000))
    const relativeTime = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    if (elapsedMinutes < 60) return relativeTime.format(-elapsedMinutes, 'minute')
    const elapsedHours = Math.floor(elapsedMinutes / 60)
    if (elapsedHours < 24) return relativeTime.format(-elapsedHours, 'hour')
    const elapsedDays = Math.floor(elapsedHours / 24)
    if (elapsedDays < 7) return relativeTime.format(-elapsedDays, 'day')
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
      timestamp,
    )
  }

  if (error)
    return (
      <section className="flex min-w-0 flex-col gap-2 pt-6">
        <h2 className="system-md-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.recentActivity'])}
        </h2>
        <Panel className="flex h-50 border border-components-panel-border p-4 shadow-none">
          <div
            role="alert"
            className="flex min-h-0 flex-1 flex-col items-center justify-center text-center"
          >
            <span aria-hidden className="i-ri-error-warning-line size-6 text-text-tertiary" />
            <p className="mt-3 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.tasksErrorDescription'])}
            </p>
            <Button
              className="mt-4"
              loading={retrying}
              size="small"
              variant="secondary"
              onClick={onRetry}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className={cn('flex min-w-0 flex-col gap-2 pt-6', indexing ? 'h-66.75' : 'h-63')}>
        <h2 className="system-md-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.recentActivity'])}
        </h2>
        <Panel
          className={cn(
            'flex border border-components-panel-border p-4 shadow-none',
            indexing ? 'h-53.75' : 'h-50',
          )}
        >
          <EmptyInline
            icon="i-ri-time-line"
            title={
              indexing
                ? t(($) => $['newKnowledge.overview.syncInProgress'])
                : t(($) => $['newKnowledge.overview.noActivity'])
            }
            description={
              indexing
                ? t(($) => $['newKnowledge.overview.syncInProgressDescription'])
                : t(($) => $['newKnowledge.overview.noActivityDescription'])
            }
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex min-w-0 flex-col gap-2 pt-6">
      <header className="flex h-6 items-center justify-between">
        <h2 className="text-[16px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.recentActivity'])}
        </h2>
        <Button disabled={loading} size="small" variant="secondary" onClick={onOpenAll}>
          {t(($) => $['newKnowledge.overview.allActivity'])}
        </Button>
      </header>
      <Panel className="flex h-63.5 flex-col overflow-hidden border border-divider-subtle px-4 pt-4 pb-3 shadow-none">
        {loading || tasks.length ? (
          <div
            role="table"
            aria-label={t(($) => $['newKnowledge.overview.recentActivity'])}
            className="min-w-151"
          >
            <div
              role="row"
              className="grid grid-cols-[100px_minmax(280px,1fr)_200px] items-center gap-3 pb-2 system-2xs-medium-uppercase text-text-tertiary"
            >
              <span role="columnheader" className="opacity-0">
                {t(($) => $['newKnowledge.overview.when'])}
              </span>
              <span role="columnheader">{t(($) => $['newKnowledge.overview.activity'])}</span>
              <span role="columnheader">{t(($) => $['newKnowledge.overview.operator'])}</span>
            </div>
            <div className="h-px bg-divider-subtle" />
            {loading
              ? [
                  ['activity-1', 55],
                  ['activity-2', 55],
                  ['activity-3', 55],
                  ['activity-4', 55],
                  ['activity-5', 41],
                ].map(([key, width]) => (
                  <div key={key} role="row" className="flex h-9 items-center py-2">
                    <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
                  </div>
                ))
              : tasks.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    role="row"
                    className="-mx-3 grid h-9 grid-cols-[100px_minmax(280px,1fr)_200px] items-center gap-3 rounded-lg px-3 system-xs-regular transition-colors hover:bg-state-base-hover motion-reduce:transition-none"
                  >
                    <span role="cell" className="whitespace-nowrap text-text-tertiary">
                      {formatWhen(task.updated_at)}
                    </span>
                    <span role="cell" className="min-w-0 truncate text-text-secondary">
                      <strong className="font-semibold text-text-primary">
                        {operationLabel(task, t)}
                      </strong>
                      {' — '}
                      {activityLabel(task, t)}
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-2">
                      <span className="system-2xs-semibold flex size-5 shrink-0 items-center justify-center rounded-full bg-util-colors-gray-gray-300 text-text-secondary">
                        S
                      </span>
                      <span className="truncate text-text-secondary">
                        {t(($) => $['newKnowledge.overview.system'])}
                      </span>
                    </span>
                  </div>
                ))}
          </div>
        ) : (
          <EmptyInline
            icon="i-ri-history-line"
            title={t(($) => $['newKnowledge.overview.noActivity'])}
            description={t(($) => $['newKnowledge.overview.noActivityDescription'])}
          />
        )}
      </Panel>
    </section>
  )
}

function ActivityDrawer({
  hasNextPage,
  isFetchingNextPage,
  loading,
  onFetchNextPage,
  onOpenChange,
  open,
  tasks,
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  loading: boolean
  onFetchNextPage: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  tasks: KnowledgeFsBackgroundTaskResponse[]
}) {
  const { t, i18n } = useTranslation('dataset')
  const { t: tDeployments } = useTranslation('deployments')
  const [range, setRange] = useState<ActivityRange>('7d')
  const rangeTriggerRef = useRef<HTMLButtonElement>(null)
  const restoreFilterFocusRef = useRef(false)
  const now = dayjs()
  const filteredTasks = tasks.filter((task) => {
    if (range === 'all') return true
    const createdAt = dayjs(task.created_at)
    if (range === 'today') return createdAt.isAfter(now.startOf('day'))
    return createdAt.isAfter(now.subtract(Number.parseInt(range), 'day'))
  })
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        day: 'numeric',
        month: 'short',
        weekday: 'short',
      }),
    [i18n.language],
  )
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }),
    [i18n.language],
  )
  const groups = filteredTasks.reduce<Record<string, KnowledgeFsBackgroundTaskResponse[]>>(
    (result, task) => {
      const key = dayjs(task.created_at).format('YYYY-MM-DD')
      result[key] ??= []
      result[key].push(task)
      return result
    },
    {},
  )
  const groupLabel = (key: string) => {
    const date = dayjs(key)
    if (date.isSame(now, 'day')) return t(($) => $['newKnowledge.overview.today'])
    if (date.isSame(now.subtract(1, 'day'), 'day'))
      return t(($) => $['newKnowledge.overview.yesterday'])
    return dateFormatter.format(date.toDate())
  }
  const rangeLabel: Record<ActivityRange, string> = {
    '30d': t(($) => $['newKnowledge.overview.last30Days']),
    '7d': t(($) => $['newKnowledge.overview.last7Days']),
    '90d': t(($) => $['newKnowledge.overview.last90Days']),
    all: t(($) => $['newKnowledge.overview.allTime']),
    today: t(($) => $['newKnowledge.overview.today']),
  }
  const clearFilters = () => {
    restoreFilterFocusRef.current = true
    setRange('7d')
  }

  useEffect(() => {
    if (!restoreFilterFocusRef.current) return
    restoreFilterFocusRef.current = false
    rangeTriggerRef.current?.focus({ preventScroll: true })
  }, [range])

  return (
    <Drawer open={open} swipeDirection="right" onOpenChange={onOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:w-120 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <header className="flex h-16 shrink-0 items-center px-5">
                <div className="flex w-full items-center justify-between gap-3">
                  <DrawerTitle className="system-lg-semibold text-text-primary">
                    {t(($) => $['newKnowledge.overview.allActivity'])}
                  </DrawerTitle>
                  <DrawerCloseButton />
                </div>
              </header>
              <div className="flex h-9 shrink-0 border-b border-divider-subtle px-5">
                <Select value={range} onValueChange={(value) => setRange(value as ActivityRange)}>
                  <SelectTrigger
                    ref={rangeTriggerRef}
                    aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
                    className="h-6 min-w-0 flex-1 border-0 bg-background-section shadow-none"
                  >
                    <span className="truncate">{rangeLabel[range]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(rangeLabel) as ActivityRange[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        <SelectItemText>{rangeLabel[value]}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-5 pt-3">
                    <Skeleton className="ml-5 h-3 w-14" />
                    <div className="mt-2 space-y-0">
                      {[248, 300, 210, 280, 236, 264].map((width) => (
                        <div key={width} className="flex h-13.5 items-center px-5">
                          <Skeleton className="size-6 shrink-0 rounded-full" />
                          <div className="ml-3 min-w-0 flex-1">
                            <Skeleton className="h-3" style={{ width }} />
                            <Skeleton className="mt-1.5 h-2.5 w-37" />
                          </div>
                          <Skeleton className="h-2.5 w-10" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : filteredTasks.length ? (
                  <>
                    {Object.entries(groups).map(([key, group]) => (
                      <section key={key}>
                        <h3 className="sticky top-0 z-10 flex h-11 items-end bg-components-panel-bg px-5 pb-2 system-xs-regular text-text-tertiary">
                          {groupLabel(key)}
                        </h3>
                        <ul>
                          {group.map((task) => (
                            <li
                              key={task.id}
                              className="flex min-h-13.5 items-start gap-3 px-5 py-2.5"
                            >
                              <span className="system-2xs-semibold flex size-6 shrink-0 items-center justify-center rounded-full bg-util-colors-gray-gray-300 text-text-secondary">
                                S
                              </span>
                              <div className="min-w-0 flex-1 leading-4">
                                <p className="line-clamp-2 system-sm-regular text-text-secondary">
                                  {activityLabel(task, t)}
                                </p>
                                <p className="system-xs-regular text-text-tertiary">
                                  {t(($) => $['newKnowledge.overview.system'])}
                                </p>
                              </div>
                              <time
                                className="shrink-0 system-xs-regular text-text-tertiary"
                                dateTime={task.updated_at}
                              >
                                {timeFormatter.format(new Date(task.updated_at))}
                              </time>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                    <div className="flex h-11 items-start justify-center pt-4">
                      {hasNextPage && (
                        <Button
                          disabled={isFetchingNextPage}
                          loading={isFetchingNextPage}
                          size="small"
                          variant="secondary"
                          onClick={onFetchNextPage}
                        >
                          {t(($) => $['newKnowledge.overview.loadMore'])}
                          <span aria-hidden className="ml-1 i-ri-arrow-down-s-line size-4" />
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-72.25 flex-col items-center justify-end pb-0 text-center">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-background-section text-text-tertiary">
                      <span aria-hidden className="i-ri-search-line size-5" />
                    </span>
                    <p className="mt-4 system-md-medium text-text-primary">
                      {t(($) => $['newKnowledge.overview.noMatchingActivity'])}
                    </p>
                    <p className="mt-1 body-xs-regular text-text-tertiary">
                      {t(($) => $['newKnowledge.overview.noMatchingActivityDescription'])}
                    </p>
                    <button
                      type="button"
                      className="mt-3 system-xs-medium text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={clearFilters}
                    >
                      {tDeployments(($) => $['list.clearFilters'])}
                    </button>
                  </div>
                )}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

function InventoryPanel({
  empty,
  error,
  indexing = false,
  inventory,
  loading,
}: {
  empty: boolean
  error: boolean
  indexing?: boolean
  inventory:
    | {
        graph_entities: { added_last_7d: number; total: number }
        graph_relations: { added_last_7d: number; total: number }
        index_coverage: { indexed: number; percentage: number; total: number }
        source_categories: {
          crawl: number
          online_documents: number
          online_drives: number
          uploads: number
        }
      }
    | undefined
  loading: boolean
}) {
  const { t } = useTranslation('dataset')
  const categories = inventory
    ? [
        {
          color: 'bg-util-colors-blue-blue-500',
          segment: 'border-util-colors-blue-blue-500 bg-util-colors-blue-blue-100',
          label: t(($) => $['newKnowledge.overview.webCrawl']),
          value: inventory.source_categories.crawl,
        },
        {
          color: 'bg-util-colors-green-green-500',
          segment: 'border-util-colors-green-green-500 bg-util-colors-green-green-100',
          label: t(($) => $['newKnowledge.overview.onlineDocuments']),
          value: inventory.source_categories.online_documents,
        },
        {
          color: 'bg-util-colors-purple-purple-500',
          segment: 'border-util-colors-purple-purple-500 bg-util-colors-purple-purple-100',
          label: t(($) => $['newKnowledge.overview.onlineDrives']),
          value: inventory.source_categories.online_drives,
        },
        {
          color: 'bg-util-colors-orange-orange-500',
          segment: 'border-util-colors-orange-orange-500 bg-util-colors-orange-orange-50',
          label: t(($) => $['newKnowledge.overview.uploads']),
          value: inventory.source_categories.uploads,
        },
      ]
    : []
  const categoryTotal = categories.reduce((total, category) => total + category.value, 0)

  if (error)
    return (
      <section className="flex h-68.75 min-w-0 flex-col gap-2 pt-6">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.inventory'])}
        </h2>
        <Panel className="flex h-54.75 border border-components-panel-border p-4 shadow-none">
          <OverviewErrorInline />
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className={cn('flex min-w-0 flex-col gap-2 pt-6', indexing ? 'h-65.25' : 'h-68.75')}>
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.inventory'])}
        </h2>
        <Panel
          className={cn(
            'flex border border-components-panel-border p-4 shadow-none',
            indexing ? 'h-51.25' : 'h-54.75',
          )}
        >
          <EmptyInline
            icon="i-ri-file-text-line"
            title={
              indexing
                ? t(($) => $['newKnowledge.overview.indexingInProgress'])
                : t(($) => $['newKnowledge.documentsEmptyTitle'])
            }
            description={
              indexing
                ? t(($) => $['newKnowledge.overview.indexingInProgressDescription'])
                : t(($) => $['newKnowledge.documentsEmptyDescription'])
            }
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex min-w-0 flex-col gap-2 pt-6">
      <h2 className="flex h-6 items-center text-[16px] leading-6 font-medium text-text-secondary">
        {t(($) => $['newKnowledge.overview.inventory'])}
      </h2>
      <Panel className="h-45 overflow-hidden border border-divider-subtle p-4 shadow-none">
        {loading ? (
          <>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="mt-2.5 h-3.5 w-80" />
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-20 rounded-lg bg-background-section p-3">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="mt-2 h-5 w-24" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div
              className="flex h-6 gap-0.5 overflow-hidden"
              aria-label={t(($) => $['newKnowledge.overview.sources'])}
            >
              {categories.map((category) => (
                <span
                  key={category.label}
                  className={cn('border-l-4', category.segment)}
                  style={{
                    width: categoryTotal ? `${(category.value / categoryTotal) * 100}%` : '0%',
                  }}
                />
              ))}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {categories.map((category) => (
                <li
                  key={category.label}
                  className="flex items-center gap-1.5 system-xs-regular text-text-tertiary"
                >
                  <span aria-hidden className={cn('size-2 rounded-full', category.color)} />
                  {category.label}
                  <span className="font-semibold text-text-secondary">{category.value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                {
                  detail: `+${inventory?.graph_entities.added_last_7d ?? 0}`,
                  label: t(($) => $['newKnowledge.overview.graphEntities']),
                  value: compactNumber(inventory?.graph_entities.total ?? 0),
                },
                {
                  detail: `+${inventory?.graph_relations.added_last_7d ?? 0}`,
                  label: t(($) => $['newKnowledge.overview.graphRelations']),
                  value: compactNumber(inventory?.graph_relations.total ?? 0),
                },
                {
                  detail: t(($) => $['newKnowledge.overview.indexedSlices'], {
                    indexed: inventory?.index_coverage.indexed ?? 0,
                    total: inventory?.index_coverage.total ?? 0,
                  }),
                  label: t(($) => $['newKnowledge.overview.indexCoverage']),
                  value: `${Math.round(inventory?.index_coverage.percentage ?? 0)}%`,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex h-20 flex-col gap-1 rounded-lg bg-background-section p-3"
                >
                  <p className="system-2xs-medium text-text-tertiary">{item.label}</p>
                  <p className="text-[18px] leading-5 font-semibold text-text-primary">
                    {item.value}
                  </p>
                  <p className="system-2xs-regular text-text-tertiary">{item.detail}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </section>
  )
}

function Onboarding({
  canConnectSource,
  canUpload,
  failedTask,
  indexingTask,
  knowledgeSpaceId,
  onRetryTask,
}: {
  canConnectSource: boolean
  canUpload: boolean
  failedTask?: KnowledgeFsBackgroundTaskResponse
  indexingTask?: KnowledgeFsBackgroundTaskResponse
  knowledgeSpaceId: string
  onRetryTask: () => Promise<unknown>
}) {
  const { t } = useTranslation('dataset')
  const [pendingAction, setPendingAction] = useState<'source' | 'upload'>()
  const retryTaskMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post.mutationOptions(),
  )
  const actionCount = Number(canConnectSource) + Number(canUpload)
  const description = canConnectSource
    ? canUpload
      ? t(($) => $['newKnowledge.overview.noSourcesDescription'])
      : t(($) => $['newKnowledge.connectSourceDescription'])
    : canUpload
      ? t(($) => $['newKnowledge.uploadFilesDescription'])
      : t(($) => $['newKnowledge.overview.readOnlyDescription'])
  const failedTaskDescription =
    failedTask?.operation === 'document_upload' || failedTask?.operation === 'document_processing'
      ? t(($) => $['newKnowledge.documentUploadFailed'])
      : t(($) => $['newKnowledge.addSourceFailed'])
  const retryFailedTask = async () => {
    if (!failedTask?.can_retry || retryTaskMutation.isPending) return

    try {
      await retryTaskMutation.mutateAsync({
        params: {
          control_space_id: knowledgeSpaceId,
          task_id: failedTask.id,
          task_kind: failedTask.task_kind,
        },
      })
      await onRetryTask()
    } catch {
      // Mutation state keeps the retry feedback visible.
    }
  }

  if (indexingTask)
    return (
      <section className="flex h-29.75 flex-col rounded-xl bg-background-section p-4">
        <h2 className="text-[18px] leading-6 font-semibold text-text-primary">
          {t(($) => $['newKnowledge.overview.indexing'])}
        </h2>
        <p className="mt-0.5 body-xs-regular text-text-secondary">
          {t(($) => $['newKnowledge.overview.indexingConnectedDescription'])}
        </p>
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-util-colors-gray-gray-200">
            <div
              className="h-full rounded-full bg-components-progress-bar-progress-solid"
              style={{ width: `${indexingTask.progress_percent}%` }}
            />
          </div>
          <p className="mt-2 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.overview.indexedDocuments'], {
              indexed: indexingTask.progress_completed,
              total: indexingTask.progress_total,
            })}
          </p>
        </div>
      </section>
    )

  return (
    <section
      className={cn(
        'h-auto min-w-0 rounded-xl bg-background-section p-4',
        actionCount > 0 && !failedTask && 'md:h-54.75',
      )}
    >
      <div aria-hidden className="flex h-4 items-center gap-1.5 text-text-tertiary">
        <span className="text-[13px] leading-4">🔥</span>
        <span className="i-custom-public-llm-jina size-4" />
        <span className="i-custom-public-common-notion size-4" />
        <span className="i-custom-public-common-google-drive size-4" />
        <span className="i-custom-public-common-confluence size-4" />
        <span className="i-ri-more-fill size-4" />
      </div>
      <div className={cn('mt-3', failedTask ? 'min-h-10.5' : 'h-10.5')}>
        <h2 className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.overview.noSources'])}
        </h2>
        {failedTask ? (
          <div
            role="alert"
            className="mt-1 flex min-h-6 items-center justify-between gap-3 text-text-destructive"
          >
            <p className="body-xs-regular">
              {retryTaskMutation.isError
                ? t(($) => $['newKnowledge.detailErrorDescription'])
                : failedTaskDescription}
            </p>
            {failedTask.can_retry && (
              <Button
                size="small"
                variant="secondary"
                loading={retryTaskMutation.isPending}
                onClick={() => void retryFailedTask()}
              >
                {t(($) => $['newKnowledge.retryTask'])}
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-1 body-xs-regular text-text-tertiary">{description}</p>
        )}
      </div>
      {actionCount > 0 && (
        <div
          className={cn('mt-3 grid gap-3', actionCount === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1')}
        >
          {canConnectSource && (
            <Link
              aria-label={t(($) => $['newKnowledge.overview.connectSource'])}
              aria-busy={pendingAction === 'source' || undefined}
              aria-disabled={pendingAction !== undefined}
              className={cn(
                'flex h-26.25 flex-col items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg text-center outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                pendingAction !== undefined && 'pointer-events-none opacity-50',
              )}
              href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
              tabIndex={pendingAction === undefined ? undefined : -1}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                if (pendingAction !== undefined) {
                  event.preventDefault()
                  return
                }
                setPendingAction('source')
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'size-6 text-text-accent',
                  pendingAction === 'source'
                    ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                    : 'i-ri-node-tree',
                )}
              />
              <span className="mt-2 system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.overview.connectSource'])}
              </span>
              <span className="mt-0.5 system-sm-regular text-text-tertiary">
                {t(($) => $['newKnowledge.connectSourceDescription'])}
              </span>
            </Link>
          )}
          {canUpload && (
            <Link
              aria-label={t(($) => $['newKnowledge.overview.uploadFiles'])}
              aria-busy={pendingAction === 'upload' || undefined}
              aria-disabled={pendingAction !== undefined}
              className={cn(
                'flex h-26.25 flex-col items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg text-center outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                pendingAction !== undefined && 'pointer-events-none opacity-50',
              )}
              href={`${newKnowledgeDocumentsPath(knowledgeSpaceId)}?upload=1`}
              tabIndex={pendingAction === undefined ? undefined : -1}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                if (pendingAction !== undefined) {
                  event.preventDefault()
                  return
                }
                setPendingAction('upload')
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'size-6 text-text-accent',
                  pendingAction === 'upload'
                    ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                    : 'i-ri-file-text-line',
                )}
              />
              <span className="mt-2 system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.overview.uploadFiles'])}
              </span>
              <span className="mt-0.5 system-sm-regular text-text-tertiary">
                {t(($) => $['newKnowledge.uploadFilesDescription'])}
              </span>
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

export function KnowledgeOverviewPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const canConnectSource = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const canUpload =
    uploadAvailable && hasPermission(datasetDefaultPermissionKeys, DatasetACLPermission.Edit)
  const [window, setWindow] = useQueryState('window', overviewWindowParser)
  const [activityOpen, setActivityOpen] = useState(false)
  const tasksQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          limit: TASK_PAGE_SIZE,
        },
      }),
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.data.some((task) => ACTIVE_TASK_STATES.has(task.state)),
        )
          ? OVERVIEW_REFRESH_INTERVAL
          : false,
    }),
  )
  const tasks = tasksQuery.data?.pages.flatMap((page) => page.data) ?? []
  const hasActiveTasks = tasks.some((task) => ACTIVE_TASK_STATES.has(task.state))
  const latestTaskUpdatedAt = tasks.reduce<number | undefined>((latest, task) => {
    const updatedAt = Date.parse(task.updated_at)
    if (!Number.isFinite(updatedAt)) return latest
    return latest === undefined || updatedAt > latest ? updatedAt : latest
  }, undefined)
  const statsQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.stats.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { window },
      },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const outcomesQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.queryOutcomes.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { window: QUERY_OUTCOMES_WINDOW },
      },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const inventoryQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.inventory.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const healthQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.health.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const indexingTask = tasks.find(
    (task) => ACTIVE_TASK_STATES.has(task.state) && isFirstSourceTask(task),
  )
  const latestFirstSourceTask = tasks
    .filter(isFirstSourceTask)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
  const failedTask = latestFirstSourceTask?.state === 'failed' ? latestFirstSourceTask : undefined
  const pageLoading =
    tasksQuery.isPending ||
    statsQuery.isPending ||
    outcomesQuery.isPending ||
    inventoryQuery.isPending ||
    healthQuery.isPending
  const firstLoadFailed =
    !pageLoading &&
    (statsQuery.isError || outcomesQuery.isError || inventoryQuery.isError || healthQuery.isError)
  const hasContent =
    (statsQuery.data?.source_count ?? 0) > 0 || (statsQuery.data?.documents ?? 0) > 0
  const empty = !pageLoading && !statsQuery.isError && !hasContent
  const showIndexing =
    !pageLoading &&
    !inventoryQuery.isError &&
    (inventoryQuery.data?.index_coverage.indexed ?? 0) === 0 &&
    indexingTask !== undefined
  const showEmptyModules = empty || showIndexing
  const retry = () =>
    void Promise.all([
      statsQuery.refetch(),
      outcomesQuery.refetch(),
      inventoryQuery.refetch(),
      healthQuery.refetch(),
      tasksQuery.refetch(),
    ])

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-components-panel-bg">
      <div className="mx-auto w-full max-w-332 px-5 py-6 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['newKnowledge.overviewTitle'])}
          </h1>
          {!empty && !showIndexing && (
            <SegmentedControl<OverviewWindow>
              aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
              value={[window]}
              onValueChange={(values) => {
                const nextWindow = values[0]
                if (nextWindow) void setWindow(nextWindow)
              }}
            >
              {WINDOWS.map((value) => (
                <SegmentedControlItem<OverviewWindow>
                  key={value}
                  className="h-6.5 px-3 system-xs-medium"
                  value={value}
                >
                  {value === '24h'
                    ? value
                    : value === '7d'
                      ? t(($) => $['newKnowledge.overview.sevenDays'])
                      : t(($) => $['newKnowledge.overview.thirtyDays'])}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          )}
        </header>

        {firstLoadFailed && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-divider-regular bg-background-section p-4"
          >
            <p className="system-sm-regular text-text-destructive">
              {t(($) => $['newKnowledge.detailErrorDescription'])}
            </p>
            <Button size="small" variant="secondary" onClick={retry}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}

        {showIndexing && (
          <div className="mt-3">
            <Onboarding
              canConnectSource={canConnectSource}
              canUpload={canUpload}
              failedTask={failedTask}
              knowledgeSpaceId={knowledgeSpaceId}
              indexingTask={indexingTask}
              onRetryTask={tasksQuery.refetch}
            />
          </div>
        )}
        {empty && (
          <div className="mt-3">
            <Onboarding
              canConnectSource={canConnectSource}
              canUpload={canUpload}
              failedTask={failedTask}
              knowledgeSpaceId={knowledgeSpaceId}
              onRetryTask={tasksQuery.refetch}
            />
          </div>
        )}
        <div
          className={cn(
            'grid gap-3 sm:grid-cols-2 xl:grid-cols-5',
            showEmptyModules ? 'mt-3 pt-6' : 'mt-3',
          )}
        >
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.queries'])}
            help={t(($) => $['newKnowledge.overview.queriesHelp'])}
            value={statsQuery.data ? compactNumber(statsQuery.data.queries.value) : '—'}
            change={
              statsQuery.data
                ? changeLabel(
                    statsQuery.data.queries.change_rate === null
                      ? null
                      : statsQuery.data.queries.change_rate * 100,
                  )
                : undefined
            }
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.answerRate'])}
            help={t(($) => $['newKnowledge.overview.answerRateHelp'])}
            value={
              statsQuery.data ? `${Math.round(statsQuery.data.answer_rate.value * 100)}%` : '—'
            }
            change={
              statsQuery.data
                ? changeLabel(statsQuery.data.answer_rate.change_percentage_points, 'pp')
                : undefined
            }
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.documents'])}
            value={statsQuery.data ? compactNumber(statsQuery.data.documents) : '—'}
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.linkedApps'])}
            value={statsQuery.data ? compactNumber(statsQuery.data.linked_apps) : '—'}
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.freshness'])}
            help={t(($) => $['newKnowledge.overview.freshnessHelp'])}
            value={formatDuration(statsQuery.data?.freshness_seconds)}
          />
        </div>
        <div
          className={cn(
            'grid lg:grid-cols-2',
            showIndexing ? 'mt-4.5 gap-2.5' : showEmptyModules ? 'mt-2 gap-2.5' : 'mt-2 gap-3',
          )}
        >
          <HealthPanel
            empty={showEmptyModules}
            error={healthQuery.isError}
            health={healthQuery.data}
            knowledgeSpaceId={knowledgeSpaceId}
            loading={pageLoading}
          />
          <QueryOutcomesChart
            buckets={outcomesQuery.data?.buckets ?? []}
            empty={showEmptyModules}
            error={outcomesQuery.isError}
            loading={pageLoading}
          />
        </div>
        <div className="mt-3">
          <RecentActivity
            empty={showEmptyModules}
            error={tasksQuery.isError}
            indexing={showIndexing}
            loading={pageLoading}
            retrying={tasksQuery.isRefetching}
            tasks={tasks}
            onOpenAll={() => {
              setActivityOpen(true)
              void tasksQuery.refetch()
            }}
            onRetry={() => void tasksQuery.refetch()}
          />
        </div>
        <div className="mt-3">
          <InventoryPanel
            empty={showEmptyModules}
            error={inventoryQuery.isError}
            indexing={showIndexing}
            inventory={inventoryQuery.data}
            loading={pageLoading}
          />
        </div>
      </div>
      <ActivityDrawer
        hasNextPage={Boolean(tasksQuery.hasNextPage)}
        isFetchingNextPage={tasksQuery.isFetchingNextPage}
        loading={tasksQuery.isPending || tasksQuery.isRefetching}
        open={activityOpen}
        tasks={tasks}
        onFetchNextPage={() => void tasksQuery.fetchNextPage()}
        onOpenChange={setActivityOpen}
      />
    </main>
  )
}
