'use client'
import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { QueryFunction, QueryKey, UseQueryOptions } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import type { SelectorParam } from 'i18next'
import type { ReactNode } from 'react'
import type { ChartRow } from './app-chart-utils'
import { Button } from '@langgenius/dify-ui/button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useQueries } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react/esm/core'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { echarts } from '@/app/components/base/line-chart/echarts'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'
import {
  buildChartOptions,
  CHART_TYPE_CONFIG,
  defaultPeriod,
  getChartValueField,
  getDefaultChartData,
  getSummaryValue,
  getTokenSummary,
  hasNonZeroChartData,
} from './app-chart-utils'

export type PeriodParams = {
  name: string
  query?: {
    start: string
    end: string
  }
}

export type TimeRange = {
  start: Dayjs
  end: Dayjs
}

export type PeriodParamsWithTimeRange = {
  name: string
  query?: TimeRange
}

type AppChartsProps = {
  appMode: AppDetailWithSite['mode']
  period: PeriodParams
  id: string
}

type IChartProps = {
  className?: string
  basicInfo: { title: string; explanation: string; timePeriod: string }
  valueKey?: string
  isAvg?: boolean
  unit?: string
  yMax?: number
  chartType: keyof typeof CHART_TYPE_CONFIG
  chartData: { data: ChartRow[] }
}

function ChartFrame({
  title,
  explanation,
  className,
  busy,
  children,
}: {
  title: string
  explanation: string
  className?: string
  busy?: boolean
  children: ReactNode
}) {
  const titleId = React.useId()
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={`flex h-79 w-full min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg xl:min-w-120 ${className ?? ''}`}
    >
      <div className="flex h-11 shrink-0 items-center px-6 pt-6 pb-1">
        <div className="flex min-w-0 items-center">
          <div
            id={titleId}
            className="min-w-0 truncate system-sm-semibold-uppercase text-text-secondary"
            title={title}
          >
            {title}
          </div>
          {explanation && (
            <Infotip>
              <InfotipTrigger aria-labelledby={titleId} className="ml-1" />
              <InfotipContent aria-labelledby={titleId} className="w-60">
                {explanation}
              </InfotipContent>
            </Infotip>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

const ECHARTS_RENDER_OPTIONS = { renderer: 'svg' as const }

const Chart: React.FC<IChartProps> = ({
  basicInfo: { title, explanation },
  chartType = 'conversations',
  chartData,
  valueKey,
  isAvg,
  unit = '',
  yMax,
  className,
}) => {
  const { t } = useTranslation(['appOverview'])
  const statistics = chartData.data
  const yField = getChartValueField(statistics, valueKey)
  const options = buildChartOptions({
    statistics,
    chartType,
    yField,
    yMax,
  })
  const summaryValue = getSummaryValue({
    chartType,
    statistics,
    yField,
    isAvg,
    unit,
  })
  const tokenSummary = getTokenSummary(statistics)
  const showTokenSummary =
    CHART_TYPE_CONFIG[chartType].showTokens && hasNonZeroChartData(statistics, 'total_price')
  const isZeroSummary = !hasNonZeroChartData(statistics, yField)

  return (
    <ChartFrame title={title} explanation={explanation} className={className}>
      <div className="flex h-8 shrink-0 items-baseline gap-1 px-6 py-1">
        <div
          className={`shrink-0 title-3xl-semi-bold ${isZeroSummary ? 'text-text-quaternary' : 'text-text-primary'}`}
        >
          {summaryValue}
        </div>
        {showTokenSummary && (
          <div className="min-w-0 truncate system-sm-medium text-text-tertiary">
            {t(($) => $['analysis.tokenUsage.consumed'], { ns: 'appOverview' })} Tokens{' '}
            <span>(</span>
            <span className="text-orange-400">~{tokenSummary}</span>
            <span>)</span>
          </div>
        )}
      </div>
      <div className="h-60 shrink-0 px-6 pb-4">
        <ReactECharts
          echarts={echarts}
          option={options}
          opts={ECHARTS_RENDER_OPTIONS}
          style={{ height: '100%', width: '100%' }}
        />
      </div>
    </ChartFrame>
  )
}

type ChartResponse = {
  data: ChartRow[]
}

type ChartQueryOptions<TData extends ChartResponse> = (
  id: string,
  query?: PeriodParams['query'],
) => UseQueryOptions<TData, Error, TData, QueryKey>

// oRPC tags each query key with its endpoint's response; chart cards share one untagged shape.
const toChartQueryOptions = <TQueryKey extends QueryKey>(options: {
  queryKey: TQueryKey
  queryFn: QueryFunction<ChartResponse, TQueryKey>
}): UseQueryOptions<ChartResponse, Error, ChartResponse, QueryKey> => ({
  queryKey: options.queryKey,
  queryFn: (context) => options.queryFn({ ...context, queryKey: options.queryKey }),
})

const CHART_TRANSLATION_SELECTOR_MAP = {
  'analysis.activeUsers.explanation': ($) => $['analysis.activeUsers.explanation'],
  'analysis.activeUsers.title': ($) => $['analysis.activeUsers.title'],
  'analysis.avgResponseTime.explanation': ($) => $['analysis.avgResponseTime.explanation'],
  'analysis.avgResponseTime.title': ($) => $['analysis.avgResponseTime.title'],
  'analysis.avgSessionInteractions.explanation': ($) =>
    $['analysis.avgSessionInteractions.explanation'],
  'analysis.avgSessionInteractions.title': ($) => $['analysis.avgSessionInteractions.title'],
  'analysis.avgUserInteractions.explanation': ($) => $['analysis.avgUserInteractions.explanation'],
  'analysis.avgUserInteractions.title': ($) => $['analysis.avgUserInteractions.title'],
  'analysis.ms': ($) => $['analysis.ms'],
  'analysis.tokenPS': ($) => $['analysis.tokenPS'],
  'analysis.tokenUsage.explanation': ($) => $['analysis.tokenUsage.explanation'],
  'analysis.tokenUsage.title': ($) => $['analysis.tokenUsage.title'],
  'analysis.totalConversations.explanation': ($) => $['analysis.totalConversations.explanation'],
  'analysis.totalConversations.title': ($) => $['analysis.totalConversations.title'],
  'analysis.totalMessages.explanation': ($) => $['analysis.totalMessages.explanation'],
  'analysis.totalMessages.title': ($) => $['analysis.totalMessages.title'],
  'analysis.tps.explanation': ($) => $['analysis.tps.explanation'],
  'analysis.tps.title': ($) => $['analysis.tps.title'],
  'analysis.userSatisfactionRate.explanation': ($) =>
    $['analysis.userSatisfactionRate.explanation'],
  'analysis.userSatisfactionRate.title': ($) => $['analysis.userSatisfactionRate.title'],
} satisfies Record<string, SelectorParam<'appOverview'>>

type ChartTranslationKey = keyof typeof CHART_TRANSLATION_SELECTOR_MAP

type BizChartConfig<TData extends ChartResponse> = {
  chartType: keyof typeof CHART_TYPE_CONFIG
  titleKey: ChartTranslationKey
  explanationKey: ChartTranslationKey
  queryOptions: ChartQueryOptions<TData>
  valueKey?: string
  emptyValueKey?: string
  yMaxWhenEmpty: number
  isAvg?: boolean
  unitKey?: ChartTranslationKey
  className?: string
}

function ChartCard({
  response,
  pending,
  failed,
  retry,
  period,
  config: {
    chartType,
    titleKey,
    explanationKey,
    valueKey,
    emptyValueKey,
    yMaxWhenEmpty,
    isAvg,
    unitKey,
    className,
  },
}: {
  config: BizChartConfig<ChartResponse>
  response: ChartResponse | undefined
  pending: boolean
  failed: boolean
  retry: () => void
  period: PeriodParams
}) {
  const { t } = useTranslation(['appOverview', 'common'])
  const fallbackKey = emptyValueKey ?? valueKey
  const titleSelector: SelectorParam<'appOverview'> = CHART_TRANSLATION_SELECTOR_MAP[titleKey]
  const explanationSelector: SelectorParam<'appOverview'> =
    CHART_TRANSLATION_SELECTOR_MAP[explanationKey]
  const unitSelector: SelectorParam<'appOverview'> | undefined = unitKey
    ? CHART_TRANSLATION_SELECTOR_MAP[unitKey]
    : undefined
  const title = t(titleSelector, { ns: 'appOverview', defaultValue: titleKey })
  const explanation = t(explanationSelector, { ns: 'appOverview', defaultValue: explanationKey })

  if (pending || !response) {
    return (
      <ChartFrame title={title} explanation={explanation} className={className} busy={pending}>
        {!pending && failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <p role="alert" className="system-sm-regular text-text-tertiary">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
            <Button variant="secondary" onClick={retry}>
              {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
            </Button>
          </div>
        ) : (
          <div
            role="status"
            aria-label={t(($) => $.loading, { ns: 'common' })}
            className="flex flex-1 flex-col gap-4 px-6 pt-1 pb-4"
          >
            <SkeletonRectangle className="h-6 w-16" />
            <SkeletonRectangle className="w-full flex-1" />
          </div>
        )}
      </ChartFrame>
    )
  }

  const noDataFlag = !response.data || response.data.length === 0
  const fallbackData = {
    data: getDefaultChartData({
      ...(period.query ?? defaultPeriod),
      ...(fallbackKey ? { key: fallbackKey } : {}),
    }),
  }

  return (
    <Chart
      basicInfo={{
        title,
        explanation,
        timePeriod: period.name,
      }}
      chartData={noDataFlag ? fallbackData : response}
      chartType={chartType}
      valueKey={valueKey}
      isAvg={isAvg}
      unit={
        unitKey && unitSelector
          ? t(unitSelector, { ns: 'appOverview', defaultValue: unitKey })
          : undefined
      }
      className={className}
      {...(noDataFlag && { yMax: yMaxWhenEmpty })}
    />
  )
}

const MessagesChart: BizChartConfig<ChartResponse> = {
  chartType: 'messages',
  titleKey: 'analysis.totalMessages.title',
  explanationKey: 'analysis.totalMessages.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.dailyMessages.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'message_count',
  emptyValueKey: 'message_count',
  yMaxWhenEmpty: 500,
}

const ConversationsChart: BizChartConfig<ChartResponse> = {
  chartType: 'conversations',
  titleKey: 'analysis.totalConversations.title',
  explanationKey: 'analysis.totalConversations.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.dailyConversations.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'conversation_count',
  emptyValueKey: 'conversation_count',
  yMaxWhenEmpty: 500,
}

const EndUsersChart: BizChartConfig<ChartResponse> = {
  chartType: 'endUsers',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.dailyEndUsers.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'terminal_count',
  emptyValueKey: 'terminal_count',
  yMaxWhenEmpty: 500,
}

const AvgSessionInteractions: BizChartConfig<ChartResponse> = {
  chartType: 'conversations',
  titleKey: 'analysis.avgSessionInteractions.title',
  explanationKey: 'analysis.avgSessionInteractions.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.averageSessionInteractions.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'interactions',
  emptyValueKey: 'interactions',
  yMaxWhenEmpty: 500,
  isAvg: true,
}

const AvgResponseTime: BizChartConfig<ChartResponse> = {
  chartType: 'conversations',
  titleKey: 'analysis.avgResponseTime.title',
  explanationKey: 'analysis.avgResponseTime.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.averageResponseTime.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'latency',
  emptyValueKey: 'latency',
  yMaxWhenEmpty: 500,
  isAvg: true,
  unitKey: 'analysis.ms',
}

const TokenPerSecond: BizChartConfig<ChartResponse> = {
  chartType: 'conversations',
  titleKey: 'analysis.tps.title',
  explanationKey: 'analysis.tps.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.tokensPerSecond.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'tps',
  emptyValueKey: 'tps',
  yMaxWhenEmpty: 100,
  isAvg: true,
  unitKey: 'analysis.tokenPS',
  className: 'min-w-0',
}

const UserSatisfactionRate: BizChartConfig<ChartResponse> = {
  chartType: 'endUsers',
  titleKey: 'analysis.userSatisfactionRate.title',
  explanationKey: 'analysis.userSatisfactionRate.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.userSatisfactionRate.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'rate',
  emptyValueKey: 'rate',
  yMaxWhenEmpty: 1000,
  isAvg: true,
  className: 'h-full',
}

const CostChart: BizChartConfig<ChartResponse> = {
  chartType: 'costs',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.statistics.tokenCosts.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'token_count',
  emptyValueKey: 'token_count',
  yMaxWhenEmpty: 100,
}

const WorkflowMessagesChart: BizChartConfig<ChartResponse> = {
  chartType: 'conversations',
  titleKey: 'analysis.totalMessages.title',
  explanationKey: 'analysis.totalMessages.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.workflow.statistics.dailyConversations.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'runs',
  emptyValueKey: 'runs',
  yMaxWhenEmpty: 500,
}

const WorkflowDailyTerminalsChart: BizChartConfig<ChartResponse> = {
  chartType: 'endUsers',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.workflow.statistics.dailyTerminals.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'terminal_count',
  emptyValueKey: 'terminal_count',
  yMaxWhenEmpty: 500,
}

const WorkflowCostChart: BizChartConfig<ChartResponse> = {
  chartType: 'workflowCosts',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.workflow.statistics.tokenCosts.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'token_count',
  emptyValueKey: 'token_count',
  yMaxWhenEmpty: 100,
}

const AvgUserInteractions: BizChartConfig<ChartResponse> = {
  chartType: 'conversations',
  titleKey: 'analysis.avgUserInteractions.title',
  explanationKey: 'analysis.avgUserInteractions.explanation',
  queryOptions: (id, query) =>
    toChartQueryOptions(
      consoleQuery.apps.byAppId.workflow.statistics.averageAppInteractions.get.queryOptions({
        input: { params: { app_id: id }, query },
      }),
    ),
  valueKey: 'interactions',
  emptyValueKey: 'interactions',
  yMaxWhenEmpty: 500,
  isAvg: true,
}
const workflowCharts = [
  WorkflowMessagesChart,
  WorkflowDailyTerminalsChart,
  WorkflowCostChart,
  AvgUserInteractions,
]
const completionCharts = [
  ConversationsChart,
  EndUsersChart,
  AvgResponseTime,
  TokenPerSecond,
  UserSatisfactionRate,
  CostChart,
]
const chatCharts = [
  ConversationsChart,
  EndUsersChart,
  AvgSessionInteractions,
  TokenPerSecond,
  UserSatisfactionRate,
  CostChart,
  MessagesChart,
]

export function AppCharts({ id, period, appMode }: AppChartsProps) {
  const configs =
    appMode === 'workflow'
      ? workflowCharts
      : appMode === 'completion'
        ? completionCharts
        : chatCharts
  const queries = useQueries({
    queries: configs.map((config) => config.queryOptions(id, period.query)),
  })
  const pending = queries.some((query) => query.isPending)
  const retryFailedQueries = () => {
    queries
      .filter((query) => query.isError && !query.data)
      .forEach((query) => {
        void query.refetch()
      })
  }
  return (
    <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2" aria-busy={pending || undefined}>
      {configs.map((config, index) => {
        const query = queries[index]!
        return (
          <ChartCard
            key={config.titleKey}
            config={config}
            response={query.data}
            pending={pending}
            failed={query.isError}
            retry={retryFailedQueries}
            period={period}
          />
        )
      })}
    </div>
  )
}

export default Chart
